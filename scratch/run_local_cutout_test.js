const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

async function testLocalCutout() {
  console.log("Starting local background removal test...");
  const imageUrl = "https://raw.githubusercontent.com/gradio-app/gradio/main/test/test_files/bus.png";
  const tempInput = path.join(__dirname, 'temp_bus_in.png');
  const tempOutput = path.join(__dirname, 'temp_bus_out.png');

  try {
    // 1. Download image
    console.log("Downloading sample image...");
    const res = await fetch(imageUrl);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(tempInput, buffer);
    console.log("Sample image saved to:", tempInput);

    // 2. Run Python script
    console.log("Running python3 scripts/remove_bg.py...");
    const cmd = `python3 "${path.join(__dirname, '../scripts/remove_bg.py')}" "${tempInput}" "${tempOutput}"`;
    const stdout = execSync(cmd).toString();
    console.log("Python script output:", stdout);

    if (fs.existsSync(tempOutput)) {
      console.log("SUCCESS! Output cutout image exists at:", tempOutput);
      console.log("Output size:", fs.statSync(tempOutput).size, "bytes");
    } else {
      console.error("FAIL: Output file not created.");
    }
  } catch (err) {
    console.error("Test failed with error:", err.message);
    if (err.stdout) console.log("stdout:", err.stdout.toString());
    if (err.stderr) console.error("stderr:", err.stderr.toString());
  } finally {
    // Cleanup
    if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
    if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
  }
}

testLocalCutout();
