const fs = require('fs');
const path = require('path');

async function run() {
  console.log("Testing Hugging Face Serverless Inference API with HF_TOKEN...");
  
  // Load .env manually if not set
  let hfToken = process.env.HF_TOKEN;
  if (!hfToken) {
    const envPath = path.join(__dirname, '../.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const match = content.match(/HF_TOKEN\s*=\s*(.+)/);
      if (match) {
        hfToken = match[1].trim();
      }
    }
  }

  if (!hfToken) {
    console.error("FAIL: process.env.HF_TOKEN is not defined in the current shell environment or .env file.");
    return;
  }
  
  console.log("HF_TOKEN found starting with:", hfToken.substring(0, 8) + "...");
  const imageUrl = "https://raw.githubusercontent.com/gradio-app/gradio/main/test/test_files/bus.png";
  
  try {
    console.log("Downloading sample image...");
    const imgRes = await fetch(imageUrl);
    const buffer = Buffer.from(await imgRes.arrayBuffer());

    console.log("Sending binary buffer to Hugging Face Inference API...");
    const res = await fetch("https://router.huggingface.co/hf-inference/models/briaai/RMBG-1.4", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${hfToken}`,
        "Content-Type": "application/octet-stream",
      },
      body: buffer,
    });

    if (res.ok) {
      const outputBuffer = Buffer.from(await res.arrayBuffer());
      console.log("SUCCESS! Hugging Face returned processed image buffer.");
      console.log("Output buffer size:", outputBuffer.length, "bytes");
    } else {
      console.error("FAIL: Hugging Face Inference API returned status:", res.status);
      console.error("Error payload:", await res.text());
    }
  } catch (err) {
    console.error("Error during test:", err.message);
  }
}

run();
