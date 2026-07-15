async function run() {
  console.log("Testing Hugging Face RMBG-1.4 Gradio 4+ Call Endpoint...");
  const imageUrl = "https://raw.githubusercontent.com/gradio-app/gradio/main/test/test_files/bus.png";
  
  try {
    const startRes = await fetch("https://briaai-bria-rmbg-1-4.hf.space/gradio_api/call/predict", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data: [
          {
            path: imageUrl
          }
        ]
      })
    });

    if (!startRes.ok) {
      console.error("Failed to start prediction, status:", startRes.status);
      console.error(await startRes.text());
      return;
    }

    const { event_id } = await startRes.json();
    console.log("Prediction started. Event ID:", event_id);

    // Now poll the event status
    let done = false;
    let attempts = 0;
    while (!done && attempts < 10) {
      attempts++;
      console.log(`Polling attempt ${attempts}...`);
      
      const pollRes = await fetch(`https://briaai-bria-rmbg-1-4.hf.space/gradio_api/call/predict/${event_id}`);
      if (!pollRes.ok) {
        console.error("Polling failed, status:", pollRes.status);
        break;
      }

      const text = await pollRes.text();
      // Gradio sends events in event-stream format:
      // event: complete
      // data: [{"path": "...", "url": "..."}]
      
      if (text.includes("event: complete")) {
        console.log("Event complete! Parsing results...");
        const lines = text.split("\n");
        const dataLine = lines.find(l => l.startsWith("data:"));
        if (dataLine) {
          const rawData = JSON.parse(dataLine.replace("data:", "").trim());
          console.log("Result file data:", JSON.stringify(rawData, null, 2));
        } else {
          console.log("Raw SSE response text:", text);
        }
        done = true;
      } else if (text.includes("event: error")) {
        console.error("Event failed with error:", text);
        break;
      } else {
        console.log("Event progress/pending. Waiting 2 seconds...");
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  } catch (err) {
    console.error("Error in execution:", err.message);
  }
}

run();
