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
async function getAIExplanation(row, mean) {
  const prompt = `
  NAV: ${row.NAV}
  Mean NAV: ${mean}

  Explain briefly why this could be an anomaly in fund accounting.
  `;

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }]
  });

  return response.choices[0].message.content;
}


async function detectAnomalies(data) {
  const navs = data.map(d => parseFloat(d.NAV));
  const mean = navs.reduce((a,b)=>a+b,0)/navs.length;
  const std = Math.sqrt(navs.map(x => Math.pow(x-mean,2)).reduce((a,b)=>a+b,0)/navs.length);

  const results = [];

  for (const row of data) {
    const z = (row.NAV - mean)/std;
    const anomaly = Math.abs(z) > 1;

    let explanation = "Normal: NAV within expected range";

    if (anomaly) {
      explanation = await getAIExplanation(row, mean);
    }

    results.push({
      ...row,
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
