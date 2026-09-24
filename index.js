import axios from 'axios';
import dotenv from 'dotenv';
import http from 'http';

dotenv.config();

// --- سيرفر وهمي ---
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => res.end('Hybrid Ghost Bot (VAR Edition) is Active ⚽')).listen(PORT, () => {
  console.log(`🌐 سيرفر البوت الهجين يعمل بنجاح على بورت ${PORT}`);
});

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const FD_API_KEY = process.env.FD_API_KEY; 
const VIP_CLUB_TEAMS = ['Real Madrid', 'Barcelona', 'Atletico', 'Manchester City', 'Liverpool', 'Arsenal', 'Chelsea', 'Manchester United', 'Bayern', 'Paris', 'Juventus', 'Inter', 'Milan', 'Napoli'];
const VIP_NATIONAL_TEAMS = ['Egypt', 'England', 'Portugal', 'Spain', 'Germany', 'Brazil', 'France', 'Italy', 'Netherlands'];
const BANNED_TEAMS_NAMES = ['Argentina'];

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
// معالجة الأهداف (تحديث الـ VAR والهداف)
// ==========================================
function processMatches(matches, type) {
  const timestamp = Date.now(); 
  
  matches.forEach(match => {
    let matchId, homeTeam, awayTeam, homeGoals, awayGoals, status, minute, scorerStr = '';

    if (type === 'club') {
      matchId = `FD_${match.id}`;
      homeTeam = match.homeTeam?.shortName || match.homeTeam?.name || 'Unknown';
      awayTeam = match.awayTeam?.shortName || match.awayTeam?.name || 'Unknown';
      homeGoals = match.score?.fullTime?.home ?? 0;
      awayGoals = match.score?.fullTime?.away ?? 0;
      status = match.status;
      minute = match.minute ? `${match.minute}'` : (status === 'PAUSED' ? 'HT' : '');
      
      // محاولة اصطياد اسم الهداف
      if (match.goals && match.goals.length > 0) {
        const lastGoal = match.goals[match.goals.length - 1];
        if (lastGoal.scorer?.name) {
          scorerStr = `\n👟 بواسطة: <b>${lastGoal.scorer.name}</b>`;
        }
      }
    } else if (type === 'national') {
      matchId = `ESPN_${match.id}`;
      homeTeam = match.homeTeam || 'Unknown';
      awayTeam = match.awayTeam || 'Unknown';
      homeGoals = parseInt(match.homeGoals) || 0;
      awayGoals = parseInt(match.awayGoals) || 0;
      status = match.state === 'post' ? 'FINISHED' : 'IN_PLAY';
      minute = match.minute || '';
    }

    const currentScore = `${homeGoals}-${awayGoals}`;
    const currentTotal = homeGoals + awayGoals; // مجموع الأهداف الحالي
    const isLive = status !== 'FINISHED';

    if (!trackedMatches[matchId]) {
      trackedMatches[matchId] = { score: currentScore, total: currentTotal, status: status, lastUpdated: timestamp };
      
      if (isLive && currentTotal === 0) {
        sendTelegramMessage(`🏁 <b>بداية المباراة!</b>\n\n🏆 <b>${homeTeam} vs ${awayTeam}</b>\n\nمشاهدة ممتعة 🍿`);
      }
    } 
    else {
      const prevData = trackedMatches[matchId];
      const prevTotal = prevData.total ?? (parseInt(prevData.score.split('-')[0]) + parseInt(prevData.score.split('-')[1]));

      // 1. لو المجموع زاد = هدف حقيقي
      if (currentTotal > prevTotal && isLive) {
        sendTelegramMessage(`⚽ <b>جوووووووول!</b>\n\n⏱️ ${minute}\n🏆 <b>${homeTeam} ${homeGoals} - ${awayGoals} ${awayTeam}</b>${scorerStr}`);
      }
      // 2. لو المجموع قل = تدخل الفار وإلغاء هدف
      else if (currentTotal < prevTotal && isLive) {
        sendTelegramMessage(`🖥️ <b>تراجع من الـ VAR!</b>\n\nتم إلغاء الهدف لتصبح النتيجة:\n🏆 <b>${homeTeam} ${homeGoals} - ${awayGoals} ${awayTeam}</b>`);
      }

      if (prevData.status !== 'FINISHED' && status === 'FINISHED') {
        sendTelegramMessage(`🏁 <b>نهاية المباراة!</b>\n\n🏆 <b>${homeTeam} ${homeGoals} - ${awayGoals} ${awayTeam}</b>\n\nانتهت المواجهة 👏`);
      }

      trackedMatches[matchId] = { score: currentScore, total: currentTotal, status: status, lastUpdated: timestamp };
    }
  });
}

// ==========================================
// تنظيف الذاكرة كل 24 ساعة
// ==========================================
setInterval(() => {
  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  Object.keys(trackedMatches).forEach(key => {
    if (now - trackedMatches[key].lastUpdated > ONE_DAY) {
      delete trackedMatches[key];
    }
  });
}, 24 * 60 * 60 * 1000); 

// ==========================================
// التنفيذ المتوازي
// ==========================================
async function runEngines() {
  await Promise.allSettled([
    checkClubs(),
    checkNational()
  ]);
}

console.log(`[${new Date().toLocaleString('en-US', {timeZone: 'Africa/Cairo'})}] 🚀 تم تشغيل البوت الشبح المُحصّن ضد الـ VAR...`);
runEngines(); 
setInterval(runEngines, 60000);
