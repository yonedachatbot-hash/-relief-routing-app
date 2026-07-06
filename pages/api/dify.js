// DifyワークフローAPIへのプロキシ（APIキーをフロントエンドに露出させないため）

export const config = {
  api: {
    bodyParser: true,
    responseLimit: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, taskId, nodeExecutionId, inputs, user } = req.body;
  const apiKey = process.env.DIFY_API_KEY;
  const apiUrl = process.env.DIFY_API_URL || 'https://api.dify.ai/v1';

  if (!apiKey || apiKey.includes('ここに')) {
    return res.status(500).json({ error: 'APIキーが設定されていません。' });
  }

  try {
    let url, body;

    if (action === 'start') {
      url = `${apiUrl}/workflows/run`;
      body = {
        inputs: inputs || {},
        response_mode: 'streaming',
        user: user || 'demo-user',
      };
    } else if (action === 'resume') {
      url = `${apiUrl}/workflows/tasks/${taskId}/node-resumptions`;
      body = {
        node_execution_id: nodeExecutionId,
        inputs: inputs || {},
        user: user || 'demo-user',
      };
    } else {
      return res.status(400).json({ error: '不正なアクションです' });
    }

    const difyRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!difyRes.ok) {
      const errText = await difyRes.text();
      return res.status(difyRes.status).json({ error: errText });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = difyRes.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }

    res.end();
  } catch (err) {
    console.error('Dify API エラー:', err);
    res.status(500).json({ error: err.message });
  }
}
