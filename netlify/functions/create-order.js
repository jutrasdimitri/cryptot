exports.handler = async (event, context) => {
  // 1. Gérer les requêtes OPTIONS (pour éviter les erreurs CORS)
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      },
      body: ""
    };
  }

  // 2. Rejeter tout ce qui n'est pas POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  try {
    const data = JSON.parse(event.body);
    
    // Générer un ID de commande unique pour le test
    const orderId = "CT-" + Math.random().toString(36).substr(2, 9).toUpperCase();
    const timestamp = new Date().toISOString();

    console.log(`[TEST] Commande reçue : ${orderId}`);

    // 3. Réponse JSON formatée EXACTEMENT comme ton frontend l'attend
    return {
      statusCode: 200,
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*" 
      },
      body: JSON.stringify({
        success: true,      
        orderId: orderId,   
        message: "Order created successfully (TEST MODE)",
        timestamp: timestamp
      }),
    };

  } catch (err) {
    return {
      statusCode: 400,
      body: JSON.stringify({ 
        success: false, 
        error: "Invalid JSON data" 
      }),
    };
  }
};
