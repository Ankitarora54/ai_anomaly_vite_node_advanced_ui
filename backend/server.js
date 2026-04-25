require('dotenv').config({ override: true });
const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const cors = require('cors');
const OpenAI = require("openai");
//const client = new OpenAI({ apiKey: "YOUR_API_KEY" });
const client = new OpenAI({apiKey: process.env.OPENAI_API_KEY});
const app = express();
app.use(cors());
console.log("OpenAI API Key:", process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY : "Not Loaded");
const upload = multer({ dest: 'uploads/' });
const PORT = process.env.PORT || 5000;
const ROLLING_WINDOW_SIZE = 5;
const MODIFIED_Z_SCORE_THRESHOLD = 3.5;
const DAY_OVER_DAY_CHANGE_THRESHOLD = 0.05;

function getMedian(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}

function buildExplanation(context) {
  const reasonParts = [];

  if (context.rollingAnomaly) {
    reasonParts.push(
      `NAV is materially out of line with the recent valuation pattern and may reflect a pricing break, missing trade, stale position, or corporate action not captured correctly`
    );
  }

  if (context.dayChangeAnomaly) {
    reasonParts.push(
      `NAV moved sharply versus the prior day and should be reviewed for late postings, cash movement, FX impact, security revaluation, or booking issues`
    );
  }

  if (reasonParts.length === 0) {
    return `Normal: NAV is broadly consistent with recent activity and does not show an unusual day-over-day movement.`
  }

  return `Anomaly: ${reasonParts.join('. ')}.`
}

async function getAIExplanation(row, context) {
  const fallbackExplanation = buildExplanation(context);

  if (!process.env.OPENAI_API_KEY) {
    return fallbackExplanation;
  }

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Use the trades,cash,fx_rates files from sample folder to reconcile the data and explain fund-accounting NAV anomalies in concise, simple language, mappping the anomalies to specific trades/cahs movements/fx rates. Avoid technical statistics jargon unless needed. Keep the answer to 1-2 sentences."
        },
        {
          role: "user",
          content: `
Date: ${row.Date}
NAV: ${row.NAV}
Cash: ${row.Cash}
Trades: ${row.Trades}
FX Rate: ${row.FX_Rate}
Rolling median NAV: ${context.rollingMedian}
Modified z-score: ${context.modifiedZScore}
Day-over-day NAV change: ${context.dayOverDayChangePercent}%
Detection reason: ${context.detectionReason}

Explain why this row may be anomalous in business terms for operations or fund accounting review.
          `.trim()
        }
      ]
    });

    return response.choices[0]?.message?.content?.trim() || fallbackExplanation;
  } catch (error) {
    console.error("OpenAI explanation failed:", error.message);
    return fallbackExplanation;
  }
}


async function detectAnomalies(data) {
  const results = [];

  for (let index = 0; index < data.length; index += 1) {
    const row = data[index];
    const rollingWindow = data
      .slice(Math.max(0, index - ROLLING_WINDOW_SIZE), index)
      .map((item) => parseFloat(item.NAV));
    const rollingMedian = rollingWindow.length > 0 ? getMedian(rollingWindow) : row.NAV;
    const absoluteDeviations = rollingWindow.map((value) => Math.abs(value - rollingMedian));
    const mad = absoluteDeviations.length > 0 ? getMedian(absoluteDeviations) : 0;
    const modifiedZScore = mad === 0 ? 0 : 0.6745 * (row.NAV - rollingMedian) / mad;
    const previousNav = index > 0 ? parseFloat(data[index - 1].NAV) : null;
    const dayOverDayChange = previousNav && previousNav !== 0
      ? (row.NAV - previousNav) / previousNav
      : 0;
    const rollingAnomaly = rollingWindow.length >= 3 && Math.abs(modifiedZScore) > MODIFIED_Z_SCORE_THRESHOLD;
    const dayChangeAnomaly = index > 0 && Math.abs(dayOverDayChange) > DAY_OVER_DAY_CHANGE_THRESHOLD;
    const anomaly = rollingAnomaly || dayChangeAnomaly;
    const detectionReason = anomaly
      ? [
          rollingAnomaly ? 'Rolling median/MAD' : null,
          dayChangeAnomaly ? 'Day-over-day change > 5%' : null,
        ].filter(Boolean).join(' + ')
      : 'Within rolling range';

    const explanationContext = {
      rollingAnomaly,
      dayChangeAnomaly,
      rollingMedian: Number(rollingMedian.toFixed(2)),
      modifiedZScore: Number(modifiedZScore.toFixed(2)),
      dayOverDayChangePercent: Number((dayOverDayChange * 100).toFixed(2)),
      detectionReason,
    };
    const explanation = anomaly
      ? await getAIExplanation(row, explanationContext)
      : buildExplanation(explanationContext);

    results.push({
      ...row,
      rolling_median_nav: Number(rollingMedian.toFixed(2)),
      mad: Number(mad.toFixed(2)),
      modified_z_score: Number(modifiedZScore.toFixed(2)),
      day_over_day_change_pct: Number((dayOverDayChange * 100).toFixed(2)),
      detection_reason: detectionReason,
      anomaly_flag: anomaly,
      explanation
    });
  }

  return results;
}
app.post('/upload', upload.single('file'), async (req, res) => {
  const results = [];
  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on('data', (data) => results.push({
        Date: data.Date,
        NAV: parseFloat(data.NAV),
        Cash: parseFloat(data.Cash),
        Trades: parseFloat(data.Trades),
        FX_Rate: parseFloat(data.FX_Rate)
    }))
    .on('end', async () => {
      const output = await detectAnomalies(results);
      res.json(output);
    });
});

// function detectAnomalies(data) {
//   const navs = data.map(d => parseFloat(d.NAV));
//   const mean = navs.reduce((a,b)=>a+b,0)/navs.length;
//   const std = Math.sqrt(navs.map(x => Math.pow(x-mean,2)).reduce((a,b)=>a+b,0)/navs.length);

//   return data.map(row => {
//     const z = (row.NAV - mean)/std;
//     const anomaly = Math.abs(z) > 1;

//     return{
//       ...row,
//       anomaly_flag: anomaly,
//       explanation: anomaly
//         ? `AI Insight: NAV (${row.NAV}) deviates from expected mean (${mean.toFixed(2)}). Possible pricing or data issue.`
//         : `Normal: NAV within expected range`
//     };
//   });
// }

// app.post('/upload', upload.single('file'), (req, res) => {
//   const results = [];
//   fs.createReadStream(req.file.path)
//     .pipe(csv())
//     .on('data', (data) => results.push({
//         Date: data.Date,
//         NAV: parseFloat(data.NAV),
//         Cash: parseFloat(data.Cash),
//         Trades: parseFloat(data.Trades),
//         FX_Rate: parseFloat(data.FX_Rate)
//     }))
//     .on('end', () => {
//       const output = detectAnomalies(results);
//       res.json(output);
//     });
// });

app.listen(PORT, () => {console.log(`Server running on ${PORT}`);});
//app.listen(5000, () => console.log('Server running on port 5000'));
