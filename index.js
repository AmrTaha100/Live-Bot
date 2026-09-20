import axios from 'axios';
import dotenv from 'dotenv';
import http from 'http';

dotenv.config();

// --- سيرفر وهمي لإرضاء Railway ومنعه من إغلاق البوت ---
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => res.end('Live Scores Bot is Active ⚽')).listen(PORT, () => {
  console.log(`🌐 سيرفر البوت يعمل بنجاح على بورت ${PORT}`);
});

// --- إعدادات مفاتيح التليجرام ---
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// --- نظام المفاتيح المتعددة (Fallback) ---
// يسحب المفاتيح المفصولة بفاصلة من ملف .env
const rawKeys = process.env.API_SPORTS_KEYS || '';
const API_KEYS = rawKeys.split(',').map(k => k.trim()).filter(k => k.length > 0);
let currentKeyIndex = 0; // المؤشر الذي يحدد أي مفتاح يعمل الآن

// --- أندية القمة ---
const LALIGA_VIP_TEAMS = [529, 541, 530]; // برشلونة، ريال مدريد، أتلتيكو
const UCL_VIP_TEAMS = [50, 40, 42, 49, 529, 541, 530, 157, 85, 496, 505, 489];

// --- المنتخبات الوطنية ---
const VIP_NATIONAL_TEAMS = [32, 10, 27, 9, 25, 6]; // مصر، إنجلترا، البرتغال، إسبانيا، ألمانيا، البرازيل
const BANNED_TEAMS = [26]; // الأرجنتين (محظورة تماماً)
const INTL_LEAGUES = [5, 32, 34, 10]; // بطولات المنتخبات

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
    console.error('❌ فشل الإرسال لتليجرام:', error.response?.data?.description || error.message);
  }
}

async function checkLiveScores() {
  if (API_KEYS.length === 0) {
    return console.error('❌ المفاتيح السرية مفقودة! تأكد من إضافة API_SPORTS_KEYS');
  }

  let success = false;
  let response = null;

  // حلقة تكرارية لتجربة المفاتيح واحداً تلو الآخر إذا انتهت الباقة
  while (currentKeyIndex < API_KEYS.length && !success) {
    const currentKey = API_KEYS[currentKeyIndex];
    
    try {
      response = await axios.get('https://v3.football.api-sports.io/fixtures', {
        params: { live: 'all' },
        headers: { 'x-apisports-key': currentKey },
        timeout: 8000
      });

      // التحقق من رسائل الخطأ الخاصة بـ API-Sports (مثل انتهاء باقة الـ 100 طلب)
      if (response.data.errors && Object.keys(response.data.errors).length > 0) {
        console.warn(`⚠️ المفتاح رقم ${currentKeyIndex + 1} انتهت باقته أو به مشكلة. جاري الانتقال للمفتاح التالي...`);
        currentKeyIndex++; 
        continue; 
      }

      success = true; 
    } catch (error) {
      if (error.response && [401, 403, 429].includes(error.response.status)) {
        console.warn(`⚠️ المفتاح رقم ${currentKeyIndex + 1} مرفوض (Status: ${error.response.status}). جاري الانتقال...`);
        currentKeyIndex++;
      } else {
        console.error('❌ فشل الاتصال بالسيرفر بسبب مشكلة في الشبكة:', error.message);
        break; 
      }
    }
  }

  // إذا تم استهلاك جميع المفاتيح
  if (!success) {
    console.log(`[${new Date().toLocaleTimeString()}] 🚫 جميع المفاتيح استُهلكت! البوت في وضع الانتظار حتى تجديد الباقات غداً.`);
    
    // تصفير العداد للبدء من جديد لاحقاً (لعل وعسى يكون اليوم الجديد بدأ)
    currentKeyIndex = 0; 
    return;
  }

  try {
    const matches = response.data.response || [];
    
    const targetMatches = matches.filter(match => {
      const leagueId = match.league.id;
      const homeId = match.teams.home.id;
      const awayId = match.teams.away.id;

      if (BANNED_TEAMS.includes(homeId) || BANNED_TEAMS.includes(awayId)) return false;
      if (leagueId === 39) return true;
      if (leagueId === 140) return LALIGA_VIP_TEAMS.includes(homeId) || LALIGA_VIP_TEAMS.includes(awayId);
      if (leagueId === 2) return UCL_VIP_TEAMS.includes(homeId) || UCL_VIP_TEAMS.includes(awayId);
      if (INTL_LEAGUES.includes(leagueId)) return VIP_NATIONAL_TEAMS.includes(homeId) || VIP_NATIONAL_TEAMS.includes(awayId);

      return false; 
    });

    if (targetMatches.length === 0) {
      console.log(`[${new Date().toLocaleTimeString()}] 💤 لا توجد مباريات للأندية أو المنتخبات المحددة تُلعب حالياً.`);
      return;
    }

    targetMatches.forEach(match => {
      const matchId = match.fixture.id;
      const homeTeam = match.teams.home.name;
      const awayTeam = match.teams.away.name;
      const homeGoals = match.goals.home ?? 0;
      const awayGoals = match.goals.away ?? 0;
      const elapsed = match.fixture.status.elapsed; 
      const status = match.fixture.status.short; 

      const currentScore = `${homeGoals}-${awayGoals}`;

      if (!trackedMatches[matchId]) {
        trackedMatches[matchId] = { score: currentScore, elapsed: elapsed, status: status };
        
        if (elapsed <= 5 && (status === '1H' || status === 'LIVE')) {
          sendTelegramMessage(`🏁 <b>بداية المباراة!</b>\n\n🏆 <b>${homeTeam} vs ${awayTeam}</b>\n\nمشاهدة ممتعة 🍿`);
          console.log(`تم إرسال إشعار بداية المباراة: ${homeTeam} ضد ${awayTeam}`);
        } else {
          console.log(`مراقبة صامتة: ${homeTeam} ${currentScore} ${awayTeam} (الدقيقة ${elapsed})`);
        }
      } 
      else {
        const prevData = trackedMatches[matchId];

        if (prevData.score !== currentScore) {
          sendTelegramMessage(`⚽ <b>جوووووووول!</b>\n\n⏱️ الدقيقة: ${elapsed}'\n🏆 <b>${homeTeam} ${homeGoals} - ${awayGoals} ${awayTeam}</b>`);
          console.log(`تم رصد هدف: ${homeTeam} ${currentScore} ${awayTeam}`);
        }

        if (prevData.status !== status && status === 'FT') {
          sendTelegramMessage(`🏁 <b>نهاية المباراة!</b>\n\n🏆 <b>${homeTeam} ${homeGoals} - ${awayGoals} ${awayTeam}</b>\n\nانتهت المواجهة 👏`);
          console.log(`تم رصد نهاية المباراة: ${homeTeam} ضد ${awayTeam}`);
        }

        trackedMatches[matchId] = { score: currentScore, elapsed: elapsed, status: status };
      }
    });

  } catch (error) {
    console.error('❌ خطأ غير متوقع أثناء معالجة المباريات:', error.message);
  }
}

console.log(`[${new Date().toLocaleTimeString()}] 🚀 تم تشغيل البوت (نسخة المفاتيح المتعددة للتوقف الدولي)...`);
checkLiveScores(); 
setInterval(checkLiveScores, 60000);