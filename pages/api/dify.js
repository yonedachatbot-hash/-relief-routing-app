// DifyワークフローAPIへのプロキシ（APIキーをフロントエンドに露出させないため）

export const config = {
  api: {
    // ストリーミングレスポンスのためbodyParserを無効化
    bodyParser: true,
    responseLimit: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, taskId, inputs, user } = req.body;
  const apiKey = process.env.DIFY_API_KEY;
  const apiUrl = process.env.DIFY_API_URL || 'https://api.dify.ai/v1';

  if (!apiKey || apiKey.includes('ここに')) {
    return res.status(500).json({ error: 'APIキーが設定されていません。.env.localを確認してください。' });
  }

  try {
    let url, body;

    if (action === 'start') {
      // ワークフロー実行開始
      url = `${apiUrl}/workflows/run`;
      body = {
        inputs: inputs || {},
        response_mode: 'streaming',
        user: user || 'demo-user',
      };
    } else if (action === 'resume') {
      // 人間の入力ノードへの回答送信（Dify正式エンドポイント）
      url = `${apiUrl}/workflows/tasks/${taskId}/resume`;
      body = { inputs: inputs || {}, user: user || 'demo-user' };
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

    // SSEストリームをそのままクライアントに転送
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
