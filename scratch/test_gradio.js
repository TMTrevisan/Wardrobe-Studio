const fs = require('fs');
const path = require('path');
const { client } = require('@gradio/client');

async function run() {
  console.log("Testing @gradio/client connection to Hugging Face Space briaai/BRIA-RMBG-1.4...");
  
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

  if (hfToken) {
    console.log("Using HF_TOKEN starting with:", hfToken.substring(0, 8) + "...");
  } else {
    console.log("No HF_TOKEN found. Trying keyless connection...");
  }

  // Load a local image to test
  const testImagePath = "/Users/toddtrevisan/.gemini/antigravity/brain/cb97c1a2-a92b-4940-aebc-ee792f841464/media__1782530860216.png";
  if (!fs.existsSync(testImagePath)) {
    console.error("FAIL: Local test image does not exist at:", testImagePath);
    return;
  }

  try {
    console.log("Connecting to Gradio Space briaai/BRIA-RMBG-1.4...");
    const app = await client("briaai/BRIA-RMBG-1.4", hfToken ? { hf_token: `Bearer ${hfToken}` } : {});
    
    console.log("Preparing image blob...");
    const buffer = fs.readFileSync(testImagePath);
    const blob = new Blob([buffer], { type: 'image/png' });

    console.log("Sending prediction request to Space...");
    const result = await app.predict(0, [
      blob
    ]);

    console.log("SUCCESS! Gradio space returned response.");
    console.log("Result object:", JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("FAIL: Error during Gradio prediction:", err.message);
  }
}

run();
