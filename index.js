import axios from 'axios';
import dotenv from 'dotenv';
import http from 'http';

dotenv.config();

// --- سيرفر وهمي لإرضاء Railway ---
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => res.end('Hybrid Ghost Bot (FD + FotMob) is Active ⚽')).listen(PORT, () => {
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
// 2. إعدادات محرك المنتخبات (FotMob الخفي)
// ==========================================
// لا نحتاج لأي مفاتيح API هنا!
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
    // خطأ صامت لعدم إزعاج اللوج
  }
}

// ==========================================
// دالة تشغيل محرك المنتخبات الشبح (FotMob)
// ==========================================
async function checkNational() {
  try {
    // تجهيز تاريخ اليوم بصيغة YYYYMMDD لسيرفر FotMob
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const dateStr = `${year}${month}${day}`;

    const response = await axios.get(`https://www.fotmob.com/api/matches?date=${dateStr}`, {
      headers: { 
        // قناع تنكري (Spoofing) لإقناع السيرفر أننا متصفح كروم حقيقي وليس بوت
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 8000
    });

    const leagues = response.data.leagues || [];
    let targetMatches = [];

    leagues.forEach(league => {
      const matches = league.matches || [];
      matches.forEach(match => {
        const h = (match.home?.name || '').toLowerCase();
        const a = (match.away?.name || '').toLowerCase();

        // 1. فلترة الأرجنتين
        const isBanned = BANNED_TEAMS_NAMES.some(b => h.includes(b.toLowerCase()) || a.includes(b.toLowerCase()));
        if (isBanned) return;

        // 2. فلترة المنتخبات المفضلة
        const isVip = VIP_NATIONAL_TEAMS.some(v => h.includes(v.toLowerCase()) || a.includes(v.toLowerCase()));
        
        // 3. التأكد أن المباراة بدأت ولم تُلغى
        const isStarted = match.status?.started;
        const isCancelled = match.status?.cancelled;

        if (isVip && isStarted && !isCancelled) {
          targetMatches.push(match);
        }
      });
    });

    processMatches(targetMatches, 'national');
  } catch (error) {
    console.error('❌ خطأ في محرك FotMob للمنتخبات:', error.message);
  }
}

// ==========================================
// دالة معالجة الأهداف الموحدة للمحركين
// ==========================================
function processMatches(matches, type) {
  matches.forEach(match => {
    let matchId, homeTeam, awayTeam, homeGoals, awayGoals, status, minute;

    // توحيد البيانات بناءً على مصدرها
    if (type === 'club') {
      matchId = `FD_${match.id}`;
      homeTeam = match.homeTeam.shortName || match.homeTeam.name;
      awayTeam = match.awayTeam.shortName || match.awayTeam.name;
      homeGoals = match.score?.fullTime?.home ?? 0;
      awayGoals = match.score?.fullTime?.away ?? 0;
      status = match.status;
      minute = match.minute ? `${match.minute}'` : (status === 'PAUSED' ? 'HT' : '');
    } else if (type === 'national') {
      matchId = `FM_${match.id}`;
      homeTeam = match.home?.name;
      awayTeam = match.away?.name;
      homeGoals = match.home?.score ?? 0;
      awayGoals = match.away?.score ?? 0;
      
      const finished = match.status?.finished;
      status = finished ? 'FINISHED' : 'IN_PLAY';
      // التقاط الدقيقة أو حالة الشوطين من FotMob
      minute = match.status?.liveTime?.short || match.status?.reason?.short || '';
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

console.log(`[${new Date().toLocaleTimeString()}] 🚀 تم تشغيل البوت الشبح (Football-Data + FotMob)...`);
runEngines(); 
setInterval(runEngines, 60000); // يفحص كل دقيقة بهدوء
