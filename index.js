import axios from 'axios';
import dotenv from 'dotenv';
import http from 'http';

dotenv.config();

// --- سيرفر وهمي ---
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => res.end('Hybrid Ghost Bot (FD + ESPN) is 100% Bulletproof ⚽')).listen(PORT, () => {
  console.log(`🌐 سيرفر البوت الهجين يعمل بنجاح على بورت ${PORT}`);
});

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const FD_API_KEY = process.env.FD_API_KEY; 
const VIP_CLUB_TEAMS = ['Real Madrid', 'Barcelona', 'Atletico', 'Manchester City', 'Liverpool', 'Arsenal', 'Chelsea', 'Manchester United', 'Bayern', 'Paris', 'Juventus', 'Inter', 'Milan', 'Napoli'];
const VIP_NATIONAL_TEAMS = ['Egypt', 'England', 'Portugal', 'Spain', 'Germany', 'Brazil', 'France', 'Italy', 'Netherlands'];
const BANNED_TEAMS_NAMES = ['Argentina'];

// الذاكرة (تمت إضافة وقت التخزين لتنظيفها لاحقاً)
let trackedMatches = {};

async function sendTelegramMessage(text) {
  if (!BOT_TOKEN || !CHAT_ID) return;
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: text,
      parse_mode: 'HTML'
    });
  } catch (error) {
    console.error('❌ فشل الإرسال لتليجرام:', error.message);
  }
}

// ==========================================
// محرك الأندية
// ==========================================
async function checkClubs() {
  if (!FD_API_KEY) return;
  try {
    const response = await axios.get('https://api.football-data.org/v4/matches', {
      headers: { 'X-Auth-Token': FD_API_KEY },
      timeout: 8000
    });
    
    const matches = response.data?.matches || [];
    const targetMatches = matches.filter(match => {
      const h = (match.homeTeam?.name || '').toLowerCase();
      const a = (match.awayTeam?.name || '').toLowerCase();
      
      const isBanned = BANNED_TEAMS_NAMES.some(b => h.includes(b.toLowerCase()) || a.includes(b.toLowerCase()));
      if (isBanned) return false;

      const isVip = VIP_CLUB_TEAMS.some(v => h.includes(v.toLowerCase()) || a.includes(v.toLowerCase()));
      return ['IN_PLAY', 'PAUSED', 'FINISHED'].includes(match.status) && isVip;
    });

    processMatches(targetMatches, 'club');
  } catch (error) {
    if(error.response?.status === 429 || error.response?.status === 403) {
       console.error(`⚠️ تحذير في محرك الأندية: تأكد من صلاحية أو باقة مفتاح FD_API_KEY`);
    }
  }
}

// ==========================================
// محرك المنتخبات (ESPN)
// ==========================================
async function checkNational() {
  try {
    // 1. إصلاح فارق التوقيت: إجبار السيرفر على جلب تاريخ اليوم بتوقيت مصر
    const egyptTime = new Date().toLocaleString("en-US", {timeZone: "Africa/Cairo"});
    const now = new Date(egyptTime);
    
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const dateStr = `${year}${month}${day}`;

    const response = await axios.get(`https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?dates=${dateStr}`, {
      timeout: 8000
    });

    const events = response.data?.events || [];
    let targetMatches = [];

    events.forEach(match => {
      // 2. الحماية من الانهيار باستخدام Optional Chaining (?.)
      const competition = match?.competitions?.[0];
      if (!competition) return;

      const homeTeamData = competition?.competitors?.find(c => c.homeAway === 'home');
      const awayTeamData = competition?.competitors?.find(c => c.homeAway === 'away');

      const h = (homeTeamData?.team?.name || '').toLowerCase();
      const a = (awayTeamData?.team?.name || '').toLowerCase();

      const isBanned = BANNED_TEAMS_NAMES.some(b => h.includes(b.toLowerCase()) || a.includes(b.toLowerCase()));
      if (isBanned) return;

      const isVip = VIP_NATIONAL_TEAMS.some(v => h.includes(v.toLowerCase()) || a.includes(v.toLowerCase()));
      const state = match.status?.type?.state; 

      if (isVip && (state === 'in' || state === 'post')) {
        targetMatches.push({
          id: match.id,
          homeTeam: homeTeamData?.team?.name,
          awayTeam: awayTeamData?.team?.name,
          homeGoals: homeTeamData?.score,
          awayGoals: awayTeamData?.score,
          state: state,
          minute: match.status?.displayClock
        });
      }
    });

    processMatches(targetMatches, 'national');
  } catch (error) {
    console.error(`❌ خطأ في محرك ESPN:`, error.message);
  }
}

// ==========================================
// معالجة الأهداف
// ==========================================
function processMatches(matches, type) {
  const timestamp = Date.now(); // لغرض تنظيف الذاكرة لاحقاً
  
  matches.forEach(match => {
    let matchId, homeTeam, awayTeam, homeGoals, awayGoals, status, minute;

    if (type === 'club') {
      matchId = `FD_${match.id}`;
      homeTeam = match.homeTeam?.shortName || match.homeTeam?.name || 'Unknown';
      awayTeam = match.awayTeam?.shortName || match.awayTeam?.name || 'Unknown';
      homeGoals = match.score?.fullTime?.home ?? 0;
      awayGoals = match.score?.fullTime?.away ?? 0;
      status = match.status;
      minute = match.minute ? `${match.minute}'` : (status === 'PAUSED' ? 'HT' : '');
    } else if (type === 'national') {
      matchId = `ESPN_${match.id}`;
      homeTeam = match.homeTeam || 'Unknown';
      awayTeam = match.awayTeam || 'Unknown';
      homeGoals = match.homeGoals ?? 0;
      awayGoals = match.awayGoals ?? 0;
      status = match.state === 'post' ? 'FINISHED' : 'IN_PLAY';
      minute = match.minute || '';
    }

    const currentScore = `${homeGoals}-${awayGoals}`;
    const isLive = status !== 'FINISHED';

    if (!trackedMatches[matchId]) {
      trackedMatches[matchId] = { score: currentScore, status: status, lastUpdated: timestamp };
      
      if (isLive && homeGoals === 0 && awayGoals === 0) {
        sendTelegramMessage(`🏁 <b>بداية المباراة!</b>\n\n🏆 <b>${homeTeam} vs ${awayTeam}</b>\n\nمشاهدة ممتعة 🍿`);
        console.log(`[${type}] إشعار بداية: ${homeTeam} ضد ${awayTeam}`);
      } else {
        console.log(`[${type}] مراقبة صامتة: ${homeTeam} ${currentScore} ${awayTeam}`);
      }
    } 
    else {
      const prevData = trackedMatches[matchId];

      if (prevData.score !== currentScore && isLive) {
        sendTelegramMessage(`⚽ <b>جوووووووول!</b>\n\n⏱️ ${minute}\n🏆 <b>${homeTeam} ${homeGoals} - ${awayGoals} ${awayTeam}</b>`);
        console.log(`[${type}] رصد هدف: ${homeTeam} ${currentScore} ${awayTeam}`);
      }

      if (prevData.status !== 'FINISHED' && status === 'FINISHED') {
        sendTelegramMessage(`🏁 <b>نهاية المباراة!</b>\n\n🏆 <b>${homeTeam} ${homeGoals} - ${awayGoals} ${awayTeam}</b>\n\nانتهت المواجهة 👏`);
        console.log(`[${type}] نهاية المباراة: ${homeTeam} ضد ${awayTeam}`);
      }

      // تحديث البيانات والوقت
      trackedMatches[matchId] = { score: currentScore, status: status, lastUpdated: timestamp };
    }
  });
}

// ==========================================
// 4. تنظيف الذاكرة (Memory Cleanup) كل 24 ساعة
// ==========================================
setInterval(() => {
  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  Object.keys(trackedMatches).forEach(key => {
    // لو الماتش عدى عليه 24 ساعة، امسحه من الرامات
    if (now - trackedMatches[key].lastUpdated > ONE_DAY) {
      delete trackedMatches[key];
    }
  });
  console.log('🧹 تم تنظيف ذاكرة البوت من المباريات القديمة.');
}, 24 * 60 * 60 * 1000); // يفحص كل 24 ساعة

// ==========================================
// 3. التنفيذ المتوازي للمحركات (Concurrency)
// ==========================================
async function runEngines() {
  // Promise.allSettled يضمن تشغيلهم معاً، وحتى لو واحد فشل التاني يكمل شغل عادي
  await Promise.allSettled([
    checkClubs(),
    checkNational()
  ]);
}

console.log(`[${new Date().toLocaleTimeString('en-US', {timeZone: 'Africa/Cairo'})}] 🚀 تم تشغيل البوت الشبح المُحصّن...`);
runEngines(); 
setInterval(runEngines, 60000);
