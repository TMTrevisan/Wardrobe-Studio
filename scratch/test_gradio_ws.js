const WebSocket = require('ws');

async function run() {
  console.log("Starting Gradio WS Queue Client Test with Origin headers...");
  const imageUrl = "https://raw.githubusercontent.com/gradio-app/gradio/main/test/test_files/bus.png";
  
  try {
    const imgRes = await fetch(imageUrl);
    const buffer = await imgRes.arrayBuffer();
    const base64Image = "data:image/png;base64," + Buffer.from(buffer).toString('base64');
    console.log("Image downloaded. Size:", base64Image.length);

    // Set origin and user agent to mimic browser request
    const ws = new WebSocket("wss://briaai-bria-rmbg-1-4.hf.space/queue/join", {
      headers: {
        "Origin": "https://briaai-bria-rmbg-1-4.hf.space",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      }
    });
    
    const sessionHash = Math.random().toString(36).substring(2);

    ws.on('open', () => {
      console.log("WebSocket connected successfully. Session Hash:", sessionHash);
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      console.log("Received msg:", msg.msg);

      if (msg.msg === "send_hash") {
        ws.send(JSON.stringify({
          fn_index: 0,
          session_hash: sessionHash
        }));
      } else if (msg.msg === "send_data") {
        console.log("Sending data payload...");
        ws.send(JSON.stringify({
          fn_index: 0,
          data: [base64Image],
          session_hash: sessionHash
        }));
      } else if (msg.msg === "process_completed") {
        console.log("Process complete!");
        if (msg.output && msg.output.data && msg.output.data[0]) {
          const out = msg.output.data[0];
          if (typeof out === 'string' && out.startsWith("data:")) {
            console.log("Success! Output is base64 string starting with:", out.substring(0, 100));
          } else if (out.name || out.path) {
            console.log("Success! Output is a file object:", JSON.stringify(out, null, 2));
            const downloadUrl = `https://briaai-bria-rmbg-1-4.hf.space/file=${out.name || out.path}`;
            console.log("Download URL:", downloadUrl);
          } else {
            console.log("Output structure:", JSON.stringify(out, null, 2));
          }
        }
        ws.close();
      } else if (msg.msg === "process_failed") {
        console.error("Processing failed on server:", msg);
        ws.close();
      }
    });

    ws.on('error', (err) => {
      console.error("WS Error:", err.message);
    });

    ws.on('close', () => {
      console.log("WebSocket connection closed.");
    });

  } catch (err) {
    console.error("Error in WS flow:", err.message);
  }
}

run();
