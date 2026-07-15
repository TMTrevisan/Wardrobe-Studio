async function run() {
  console.log("Starting official Gradio Client testing for AlekseyCalvin/BRIA-RMBG-1.4...");
  const imageUrl = "https://raw.githubusercontent.com/gradio-app/gradio/main/test/test_files/bus.png";
  
  try {
    const { Client } = await import("@gradio/client");
    console.log("Initializing Gradio client for AlekseyCalvin/BRIA-RMBG-1.4...");
    const client = await Client.connect("AlekseyCalvin/BRIA-RMBG-1.4");
    
    console.log("Client connected. Triggering prediction for image:", imageUrl);
    const result = await client.predict("/predict", {
      image: imageUrl,
    });
    
    console.log("Prediction complete!");
    console.log("Result object:", JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("Gradio Client error:", err.message);
  }
}

run();
