import axios from 'axios';
import dotenv from 'dotenv';
import http from 'http';

dotenv.config();

// --- سيرفر وهمي لإرضاء Railway ---
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => res.end('Hybrid Ghost Bot (FD + ESPN) is Active ⚽')).listen(PORT, () => {
  console.log(`🌐 سيرفر البوت الهجين يعمل بنجاح على بورت ${PORT}`);
});

// --- إعدادات التليجرام ---
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// ==========================================
// 1. إعدادات محرك الأندية (Football-Data الرسمي)
// ==========================================
const FD_API_KEY = process.env.FD_API_KEY; 
const VIP_CLUB_TEAMS = [
  'Real Madrid', 'Barcelona', 'Atletico', 
  'Manchester City', 'Liverpool', 'Arsenal', 'Chelsea', 'Manchester United', 
  'Bayern', 'Paris', 'Juventus', 'Inter', 'Milan', 'Napoli'
];

// ==========================================
// 2. إعدادات محرك المنتخبات (ESPN المفتوح)
// ==========================================
const VIP_NATIONAL_TEAMS = [
  'Egypt', 'England', 'Portugal', 'Spain', 'Germany', 
  'Brazil', 'France', 'Italy', 'Netherlands'
];

// ==========================================
// القائمة السوداء الموحدة
// ==========================================
const BANNED_TEAMS_NAMES = ['Argentina'];

const trackedMatches = {};

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
// دالة تشغيل محرك الأندية (Football-Data)
// ==========================================
async function checkClubs() {
  if (!FD_API_KEY) return;
  try {
    const response = await axios.get('https://api.football-data.org/v4/matches', {
      headers: { 'X-Auth-Token': FD_API_KEY },
      timeout: 8000
    });
    
    const matches = response.data.matches || [];
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
    // تجاهل الأخطاء الصامتة
  }
}

// ==========================================
// دالة تشغيل محرك المنتخبات (ESPN الداخلي)
// ==========================================
async function checkNational() {
  try {
    // تجهيز التاريخ بصيغة YYYYMMDD لسيرفر ESPN
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const dateStr = `${year}${month}${day}`;

    // رابط ESPN السري للنتائج الحية لكل مباريات كرة القدم اليوم
    const response = await axios.get(`https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?dates=${dateStr}`, {
      timeout: 8000
    });

    const events = response.data.events || [];
    let targetMatches = [];

    events.forEach(match => {
      const competition = match.competitions[0];
      if (!competition) return;

      const homeTeamData = competition.competitors.find(c => c.homeAway === 'home');
      const awayTeamData = competition.competitors.find(c => c.homeAway === 'away');

      const h = (homeTeamData?.team?.name || '').toLowerCase();
      const a = (awayTeamData?.team?.name || '').toLowerCase();

      // 1. فلترة الأرجنتين
      const isBanned = BANNED_TEAMS_NAMES.some(b => h.includes(b.toLowerCase()) || a.includes(b.toLowerCase()));
      if (isBanned) return;

      // 2. فلترة المنتخبات المفضلة
      const isVip = VIP_NATIONAL_TEAMS.some(v => h.includes(v.toLowerCase()) || a.includes(v.toLowerCase()));
      
      // 3. التأكد من حالة المباراة في ESPN ('pre', 'in', 'post')
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
    console.error(`❌ خطأ في محرك ESPN للمنتخبات:`, error.message);
  }
}

// ==========================================
// دالة معالجة الأهداف الموحدة للمحركين
// ==========================================
function processMatches(matches, type) {
  matches.forEach(match => {
    let matchId, homeTeam, awayTeam, homeGoals, awayGoals, status, minute;

    if (type === 'club') {
      matchId = `FD_${match.id}`;
      homeTeam = match.homeTeam.shortName || match.homeTeam.name;
      awayTeam = match.awayTeam.shortName || match.awayTeam.name;
      homeGoals = match.score?.fullTime?.home ?? 0;
      awayGoals = match.score?.fullTime?.away ?? 0;
      status = match.status;
      minute = match.minute ? `${match.minute}'` : (status === 'PAUSED' ? 'HT' : '');
    } else if (type === 'national') {
      matchId = `ESPN_${match.id}`;
      homeTeam = match.homeTeam;
      awayTeam = match.awayTeam;
      homeGoals = match.homeGoals ?? 0;
      awayGoals = match.awayGoals ?? 0;
      status = match.state === 'post' ? 'FINISHED' : 'IN_PLAY';
      minute = match.minute || '';
    }

    const currentScore = `${homeGoals}-${awayGoals}`;
    const isLive = status !== 'FINISHED';

    if (!trackedMatches[matchId]) {
      trackedMatches[matchId] = { score: currentScore, status: status };
      
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

      trackedMatches[matchId] = { score: currentScore, status: status };
    }
  });
}

// تشغيل المحركين معاً
async function runEngines() {
  await checkClubs();
  await checkNational();
}

console.log(`[${new Date().toLocaleTimeString()}] 🚀 تم تشغيل البوت الشبح (Football-Data + ESPN)...`);
runEngines(); 
setInterval(runEngines, 60000);
