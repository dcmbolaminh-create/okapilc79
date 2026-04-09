const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

const URL_TRUYEN_THONG = "https://wtx.tele68.com/v1/tx/sessions";
const URL_MD5 = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

const http = axios.create({ timeout: 10000 });

// ================= DATA =================
let historyNormal = [];
let historyMd5 = [];

let predictionsNormal = [];
let predictionsMd5 = [];

// ================= MARKOV =================
class MarkovXucXac123 {
  constructor(bac = 3) {
    this.bac = bac;
    this.map = new Map();
    this.history = [];
  }

  static convert(x) {
    if (x <= 2) return 1;
    if (x <= 4) return 2;
    return 3;
  }

  add(arr) {
    this.history.push(...arr);
    if (this.history.length > 60) this.history = this.history.slice(-60);

    this.map.clear();
    for (let i = this.bac; i < this.history.length; i++) {
      const key = this.history.slice(i - this.bac, i).join(",");
      const val = this.history[i];

      if (!this.map.has(key)) this.map.set(key, {});
      this.map.get(key)[val] = (this.map.get(key)[val] || 0) + 1;
    }
  }

  predict() {
    if (this.history.length < this.bac) return 2;

    const key = this.history.slice(-this.bac).join(",");
    const data = this.map.get(key);
    if (!data) return 2;

    let best = 2, max = 0;
    for (let k in data) {
      if (data[k] > max) {
        max = data[k];
        best = parseInt(k);
      }
    }
    return best;
  }
}

// ================= NHỊP CẦU =================
function detectNhipCau(results) {
  if (results.length < 6) return null;

  const r = results.map(x => x === "TÀI" ? "T" : "X").join("");

  const patterns = [
    "TXT","XTX",
    "TTXX","XXTT",
    "TTTXXX","XXXT TT".replace(" ",""),
    "TTXTTX","XXTXXT"
  ];

  for (let p of patterns) {
    if (r.startsWith(p)) {
      return {
        type: "NHỊP",
        pattern: p,
        next: p[0] === "T" ? "TÀI" : "XỈU",
        confidence: 82
      };
    }
  }

  for (let size = 2; size <= 4; size++) {
    const chunk = r.slice(0, size);
    const repeat = chunk.repeat(3);

    if (r.startsWith(repeat)) {
      return {
        type: "CHU KỲ",
        pattern: chunk,
        next: chunk[0] === "T" ? "TÀI" : "XỈU",
        confidence: 78
      };
    }
  }

  return null;
}

// ================= TREND FULL =================
function trendFull(history) {
  const results = history.slice(0, 20).map(x => {
    const sum = x.dices.reduce((a,b)=>a+b,0);
    return sum >= 11 ? "TÀI" : "XỈU";
  });

  if (results.length < 5) {
    return {
      prediction: Math.random()>0.4?"TÀI":"XỈU",
      confidence: 55,
      reason: "Ít dữ liệu"
    };
  }

  // ===== NHỊP =====
  const nhip = detectNhipCau(results);
  if (nhip) {
    return {
      prediction: nhip.next,
      confidence: nhip.confidence,
      reason: `Nhịp cầu (${nhip.pattern})`
    };
  }

  const last10 = results.slice(0,10);
  const last5 = results.slice(0,5);

  const count = arr => ({
    tai: arr.filter(x=>x==="TÀI").length,
    xiu: arr.filter(x=>x==="XỈU").length
  });

  const c10 = count(last10);
  const c5 = count(last5);

  // ===== CẦU DÂY =====
  let streak = 1;
  for (let i=1;i<results.length;i++){
    if(results[i]===results[i-1]) streak++;
    else break;
  }

  // ===== CẦU CHÉO =====
  const cheo = results[0]!==results[1] && results[1]!==results[2];

  // ===== PATTERN =====
  const pattern = results.slice(0,6).join("-");
  let special = "";

  if (pattern === "TÀI-TÀI-TÀI-XỈU-XỈU-XỈU") special = "3-3";
  if (pattern === "TÀI-TÀI-XỈU-XỈU") special = "2-2";
  if (pattern === "TÀI-XỈU-TÀI-XỈU") special = "1-1";

  let prediction = "TÀI";
  let confidence = 65;
  let reason = "";

  if (streak >= 4) {
    prediction = results[0];
    confidence = 85;
    reason = `Cầu dây ${streak}`;
  }
  else if (cheo) {
    prediction = results[1];
    confidence = 75;
    reason = "Cầu chéo";
  }
  else if (special) {
    prediction = results[0];
    confidence = 80;
    reason = `Pattern ${special}`;
  }
  else {
    prediction = c5.tai > c5.xiu ? "TÀI" : "XỈU";
    reason = "Bám cầu ngắn";
  }

  // ===== ĐẢO =====
  if (c10.tai >= 8) {
    prediction = "XỈU";
    reason = "TÀI quá mạnh → đảo";
  }

  if (c10.xiu >= 8) {
    prediction = "TÀI";
    reason = "XỈU quá mạnh → đảo";
  }

  console.log("📈 CẦU:", { streak, c10, c5, pattern, prediction });

  return { prediction, confidence, reason };
}

// ================= AI COMBINE =================
function analyze(history) {
  const dice = [];

  for (let i=0;i<Math.min(40,history.length);i++){
    history[i].dices.forEach(d=>{
      dice.push(MarkovXucXac123.convert(d));
    });
  }

  const mk = new MarkovXucXac123(3);
  mk.add(dice.slice(-30));

  const mkRes = mk.predict() === 2 ? "XỈU" : "TÀI";
  const trend = trendFull(history);

  const final = Math.random() < 0.6 ? trend.prediction : mkRes;

  return {
    prediction: final,
    confidenceTai: final==="TÀI"?80:20,
    confidenceXiu: final==="XỈU"?80:20,
    reason: `Trend(${trend.reason}) + Markov(${mkRes})`
  };
}

// ================= CORE =================
function update(storage, history) {
  if (!history.length) return;

  const latest = history[0];
  if (storage.find(x=>x.phien===latest.id)) return;

  const ai = analyze(history);

  storage.push({
    phien: latest.id + 1,
    du_doan: ai.prediction,
    ket_qua: null,
    danh_gia: null
  });
}

function evaluate(storage, history) {
  storage.forEach(p=>{
    if(p.ket_qua) return;

    const real = history.find(h=>h.id===p.phien);
    if(!real) return;

    const sum = real.dices.reduce((a,b)=>a+b,0);
    const kq = sum>=11?"TÀI":"XỈU";

    p.ket_qua = kq;
    p.danh_gia = p.du_doan===kq?"THẮNG":"THUA";
  });
}

// ================= FORMAT =================
function format(raw, history) {
  const data = raw.list[0];
  const ai = analyze(history);

  const dices = data.dices;
  const tong = dices.reduce((a,b)=>a+b,0);

  return {
    phien: data.id,
    xuc_xac_1: dices[0],
    xuc_xac_2: dices[1],
    xuc_xac_3: dices[2],
    tong,
    ket_qua: tong>=11?"TÀI":"XỈU",
    phien_tiep_theo: data.id+1,
    du_doan: ai.prediction,
    do_tin_cay: {
      TÀI: ai.confidenceTai+"%",
      XỈU: ai.confidenceXiu+"%"
    },
    ly_do: ai.reason
  };
}

// ================= POLL =================
async function poll(){
  try{
    const [a,b] = await Promise.all([
      http.get(URL_TRUYEN_THONG),
      http.get(URL_MD5)
    ]);

    historyNormal = a.data.list;
    historyMd5 = b.data.list;

    update(predictionsNormal, historyNormal);
    update(predictionsMd5, historyMd5);

    evaluate(predictionsNormal, historyNormal);
    evaluate(predictionsMd5, historyMd5);

    console.log("✅ SYNC OK");
  }catch(e){
    console.log("❌ LỖI:", e.message);
  }
}

setInterval(poll, 5000);

// ================= API =================
app.get("/", (req,res)=>res.send("🎲 FULL AI NHỊP CẦU ADM"));

app.get("/taixiu", async (req,res)=>{
  const r = await http.get(URL_TRUYEN_THONG);
  res.json(format(r.data, historyNormal));
});

app.get("/taixiumd5", async (req,res)=>{
  const r = await http.get(URL_MD5);
  res.json(format(r.data, historyMd5));
});

app.get("/thongke", (req,res)=>{
  res.json(predictionsNormal.slice(-20));
});

// ================= START =================
app.listen(PORT, ()=>{
  console.log(`🚀 PORT ${PORT}`);
  console.log("🔥 FULL AI: MARKOV + TREND + NHỊP + ADM");
});
