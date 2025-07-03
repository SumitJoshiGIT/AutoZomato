const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

app.post('/ollama/api/generate', async (req, res) => {
  const ollamaUrl = 'http://localhost:11434/api/generate';
  console.log(`[${new Date().toISOString()}] Forwarding POST request to ${ollamaUrl}`);
  console.log('Request Body:', JSON.stringify(req.body, null, 2));

  try {
    const response = await fetch(ollamaUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
    });

    const responseData = await response.text(); // Read as text to avoid JSON parsing errors on non-JSON responses
    console.log(`[${new Date().toISOString()}] Ollama Response Status: ${response.status}`);
    console.log('Ollama Response Body:', responseData);

    // Forward Ollama's status and response to the client
    res.status(response.status).send(responseData);

  } catch (error) {
    console.error('Error forwarding request to Ollama:', error);
    res.status(500).send('Error forwarding request to Ollama');
  }
});

app.listen(3000, () => {
  console.log('Manual CORS proxy server running on http://localhost:3000');
});
