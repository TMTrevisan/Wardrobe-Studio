async function run() {
  console.log("Testing Hugging Face RMBG-1.4 Space Info Endpoint...");
  try {
    const res = await fetch("https://briaai-bria-rmbg-1-4.hf.space/info");
    if (res.ok) {
      const data = await res.json();
      console.log("Gradio Space Info loaded successfully!");
      console.log("Endpoints:", JSON.stringify(data.named_endpoints, null, 2));
    } else {
      console.error("Failed to load Space Info, status:", res.status);
    }
  } catch (err) {
    console.error("Error loading info:", err.message);
  }
}

run();
