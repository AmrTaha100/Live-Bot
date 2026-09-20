import axios from 'axios';
import dotenv from 'dotenv';
import http from 'http';

dotenv.config();

// --- سيرفر وهمي لإرضاء Railway ---
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => res.end('Live Scores Bot is Active ⚽')).listen(PORT, () => {
  console.log(`🌐 سيرفر البوت يعمل بنجاح على بورت ${PORT}`);
});

// --- إعدادات التليجرام والمفتاح الجديد ---
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const API_KEY = process.env.FD_API_KEY; // اسم المتغير الجديد

// --- القوائم المفضلة بالإنجليزية (لتطابق بيانات السيرفر) ---
const VIP_TEAMS = [
  'Real Madrid', 'Barcelona', 'Atletico', 
  'Manchester City', 'Liverpool', 'Arsenal', 'Chelsea', 'Manchester United', 
  'Bayern', 'Paris', 'Juventus', 'Inter', 'Milan', 'Napoli',
  'Egypt', 'England', 'Portugal', 'Spain', 'Germany', 'Brazil', 'France', 'Italy', 'Netherlands'
];

// --- القائمة السوداء ---
const BANNED_TEAMS = ['Argentina'];

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

// دالة لفحص ما إذا كانت المباراة تهمنا
function isVipMatch(homeName, awayName) {
  const h = homeName.toLowerCase();
  const a = awayName.toLowerCase();

  // 1. فحص القائمة السوداء أولاً (لو الأرجنتين بتلعب، ارفض فوراً)
  const isBanned = BANNED_TEAMS.some(banned => {
    const b = banned.toLowerCase();
    return h.includes(b) || a.includes(b);
  });
  if (isBanned) return false;

  // 2. فحص قائمة الـ VIP
  return VIP_TEAMS.some(vip => {
    const v = vip.toLowerCase();
    return h.includes(v) || a.includes(v);
  });
}

async function checkLiveScores() {
  if (!API_KEY) return console.error('❌ المفتاح السري مفقود! تأكد من إضافة FD_API_KEY');

  try {
    // جلب كل مباريات اليوم من Football-Data
    const response = await axios.get('https://api.football-data.org/v4/matches', {
      headers: { 'X-Auth-Token': API_KEY },
      timeout: 8000
    });

    const matches = response.data.matches || [];

    // تصفية المباريات: التي تُلعب الآن + التابعة لفرقنا
    const targetMatches = matches.filter(match => {
      const homeName = match.homeTeam?.name || '';
      const awayName = match.awayTeam?.name || '';
      const status = match.status; 

      // حالات المباراة في هذا السيرفر: IN_PLAY, PAUSED (بين الشوطين), FINISHED
      const isLiveOrFinished = ['IN_PLAY', 'PAUSED', 'FINISHED'].includes(status);

      return isLiveOrFinished && isVipMatch(homeName, awayName);
    });

    if (targetMatches.length === 0) {
      console.log(`[${new Date().toLocaleTimeString()}] 💤 لا توجد مباريات حية لأنديتك أو منتخباتك حالياً.`);
      return;
    }

    targetMatches.forEach(match => {
      const matchId = match.id;
      const homeTeam = match.homeTeam.shortName || match.homeTeam.name;
      const awayTeam = match.awayTeam.shortName || match.awayTeam.name;
      const homeGoals = match.score?.fullTime?.home ?? 0;
      const awayGoals = match.score?.fullTime?.away ?? 0;
      const status = match.status; 
      const minute = match.minute ? `${match.minute}'` : (status === 'PAUSED' ? 'HT' : '');

      const currentScore = `${homeGoals}-${awayGoals}`;

      // إذا كانت أول مرة نرصد المباراة في الذاكرة
      if (!trackedMatches[matchId]) {
        trackedMatches[matchId] = { score: currentScore, status: status };
        
        if (status === 'IN_PLAY' && homeGoals === 0 && awayGoals === 0) {
          sendTelegramMessage(`🏁 <b>بداية المباراة!</b>\n\n🏆 <b>${homeTeam} vs ${awayTeam}</b>\n\nمشاهدة ممتعة 🍿`);
          console.log(`تم إشعار بداية المباراة: ${homeTeam} ضد ${awayTeam}`);
        } else {
          console.log(`مراقبة صامتة: ${homeTeam} ${currentScore} ${awayTeam}`);
        }
      } 
      // إذا كانت المباراة مرصودة مسبقاً، نقارن التغييرات
      else {
        const prevData = trackedMatches[matchId];

        // لو النتيجة اتغيرت = هدف!
        if (prevData.score !== currentScore && (status === 'IN_PLAY' || status === 'PAUSED')) {
          sendTelegramMessage(`⚽ <b>جوووووووول!</b>\n\n⏱️ ${minute}\n🏆 <b>${homeTeam} ${homeGoals} - ${awayGoals} ${awayTeam}</b>`);
          console.log(`رصد هدف: ${homeTeam} ${currentScore} ${awayTeam}`);
        }

        // لو الحالة اتغيرت لـ FINISHED = نهاية المباراة
        if (prevData.status !== status && status === 'FINISHED') {
          sendTelegramMessage(`🏁 <b>نهاية المباراة!</b>\n\n🏆 <b>${homeTeam} ${homeGoals} - ${awayGoals} ${awayTeam}</b>\n\nانتهت المواجهة 👏`);
          console.log(`رصد نهاية المباراة: ${homeTeam} ضد ${awayTeam}`);
        }

        trackedMatches[matchId] = { score: currentScore, status: status };
      }
    });

  } catch (error) {
    const errorMsg = error.response?.data?.message || error.message;
    console.error('❌ خطأ أثناء الاتصال بسيرفر Football-Data:', errorMsg);
  }
}

console.log(`[${new Date().toLocaleTimeString()}] 🚀 تم تشغيل البوت مع واجهة Football-Data المستقرة...`);
checkLiveScores(); 
setInterval(checkLiveScores, 60000); // يفحص كل دقيقة براحته تماماً
