import { useState, useRef } from 'react';
import Head from 'next/head';

// ====== ステップ定義 ======
const STEP = {
  INPUT: 'input',        // 顧客情報入力
  RUNNING: 'running',    // AI分析中
  CONFIRM: 'confirm',    // 担当者確認（人間入力）
  PHONE: 'phone',        // 店舗電話確認（人間入力）
  DONE: 'done',          // 完了
  ERROR: 'error',        // エラー
};

export default function Home() {
  // ---- 状態管理 ----
  const [step, setStep] = useState(STEP.INPUT);
  const [formData, setFormData] = useState({
    customer_name: '',
    phone_number: '',
    origin_address: '',
    destination_address: '',
    move_date: '',
    household_size: '',
    special_notes: '',
  });
  const [aiResult, setAiResult] = useState('');       // AIの推薦テキスト
  const [taskId, setTaskId] = useState('');            // DifyタスクID
  const [finalStore, setFinalStore] = useState('');    // 担当者が選んだ店舗
  const [phoneResult, setPhoneResult] = useState(''); // 電話確認結果
  const [outputData, setOutputData] = useState(null); // 最終出力
  const [errorMsg, setErrorMsg] = useState('');
  const [logs, setLogs] = useState([]);               // 処理ログ

  const addLog = (msg) => setLogs(prev => [...prev, msg]);

  // ---- ワークフロー開始 ----
  const handleStart = async (e) => {
    e.preventDefault();
    setStep(STEP.RUNNING);
    setLogs([]);
    setAiResult('');
    addLog('🚀 ワークフロー開始中...');

    try {
      const res = await fetch('/api/dify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          inputs: formData,
          user: 'operator-001',
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'APIエラーが発生しました');
      }

      await processStream(res.body);
    } catch (err) {
      setErrorMsg(err.message);
      setStep(STEP.ERROR);
    }
  };

  // ---- SSEストリーム処理 ----
  const processStream = async (body) => {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentTaskId = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // 未完成の行をバッファに戻す

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;

        try {
          const event = JSON.parse(jsonStr);
          handleEvent(event, currentTaskId, (id) => { currentTaskId = id; });
        } catch (_) {
          // JSON解析エラーは無視
        }
      }
    }
  };

  // ---- イベントハンドラ ----
  const handleEvent = (event, currentTaskId, setCurrentTaskId) => {
    const { event: eventType, task_id, data } = event;

    // タスクIDを保存
    if (task_id && !currentTaskId) {
      setCurrentTaskId(task_id);
      setTaskId(task_id);
    }

    switch (eventType) {
      case 'workflow_started':
        addLog('📋 ワークフロー開始');
        break;

      case 'node_started':
        if (data?.title) addLog(`⚙️ ${data.title} 処理中...`);
        break;

      case 'node_finished':
        if (data?.title) addLog(`✅ ${data.title} 完了`);
        // LLMノードの出力（AI推薦テキスト）を取得
        if (data?.outputs?.text) {
          setAiResult(data.outputs.text);
        }
        // 人間の入力ノードが待機状態になったとき
        if (data?.node_type === 'human-input' || data?.execution_metadata?.node_type === 'human-input') {
          const title = data?.title || '';
          if (title.includes('担当者') || title.includes('確認')) {
            addLog('👤 担当者確認を待っています...');
            setStep(STEP.CONFIRM);
          } else if (title.includes('電話')) {
            addLog('📞 店舗電話確認を待っています...');
            setStep(STEP.PHONE);
          }
        }
        break;

      case 'text_chunk':
        // テキストの逐次表示
        if (data?.text) setAiResult(prev => prev + data.text);
        break;

      case 'workflow_finished':
        addLog('🏁 ワークフロー完了');
        if (data?.outputs) {
          setOutputData(data.outputs);
          setStep(STEP.DONE);
        }
        break;

      case 'error':
        setErrorMsg(data?.message || '不明なエラー');
        setStep(STEP.ERROR);
        break;

      default:
        break;
    }
  };

  // ---- 担当者確認送信 ----
  const handleConfirmSubmit = async (e) => {
    e.preventDefault();
    if (!finalStore.trim()) return;
    addLog(`📝 選択店舗: ${finalStore}`);
    setStep(STEP.RUNNING);

    try {
      const res = await fetch('/api/dify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'resume',
          taskId,
          inputs: { final_store: finalStore },
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || '送信エラー');
      }

      await processStream(res.body);
    } catch (err) {
      setErrorMsg(err.message);
      setStep(STEP.ERROR);
    }
  };

  // ---- 電話確認送信 ----
  const handlePhoneSubmit = async (action) => {
    setPhoneResult(action);
    addLog(`📞 電話確認: ${action === 'approve' ? '対応可' : '対応不可'}`);
    setStep(STEP.RUNNING);

    try {
      const res = await fetch('/api/dify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'resume',
          taskId,
          inputs: { _action_id: action },
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || '送信エラー');
      }

      await processStream(res.body);
    } catch (err) {
      setErrorMsg(err.message);
      setStep(STEP.ERROR);
    }
  };

  // ---- リセット ----
  const handleReset = () => {
    setStep(STEP.INPUT);
    setFormData({
      customer_name: '', phone_number: '', origin_address: '',
      destination_address: '', move_date: '', household_size: '', special_notes: '',
    });
    setAiResult('');
    setTaskId('');
    setFinalStore('');
    setPhoneResult('');
    setOutputData(null);
    setErrorMsg('');
    setLogs([]);
  };

  // ====== UI レンダリング ======
  return (
    <>
      <Head>
        <title>引越し案件振分けAI | リリーフ</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div style={styles.wrapper}>
        {/* ヘッダー */}
        <header style={styles.header}>
          <div style={styles.headerInner}>
            <div style={styles.logo}>
              <span style={styles.logoIcon}>🏠</span>
              <div>
                <div style={styles.logoTitle}>リリーフ 案件振分けAI</div>
                <div style={styles.logoSub}>コールセンター担当者支援システム</div>
              </div>
            </div>
            <div style={styles.badge}>Powered by Dify × Claude</div>
          </div>
        </header>

        <main style={styles.main}>
          {/* 顧客情報入力フォーム */}
          {step === STEP.INPUT && (
            <div style={styles.card}>
              <h2 style={styles.cardTitle}>📋 お客様情報入力</h2>
              <p style={styles.cardDesc}>受付した内容を入力してください。AIが最適な担当店舗を推薦します。</p>
              <form onSubmit={handleStart} style={styles.form}>
                <div style={styles.formGrid}>
                  <FormField label="お客様名" required>
                    <input style={styles.input} type="text" placeholder="例：山田 太郎"
                      value={formData.customer_name}
                      onChange={e => setFormData(p => ({ ...p, customer_name: e.target.value }))}
                      required />
                  </FormField>
                  <FormField label="電話番号" required>
                    <input style={styles.input} type="tel" placeholder="例：090-1234-5678"
                      value={formData.phone_number}
                      onChange={e => setFormData(p => ({ ...p, phone_number: e.target.value }))}
                      required />
                  </FormField>
                  <FormField label="引越し元（出発地）" required>
                    <input style={styles.input} type="text" placeholder="例：東京都新宿区西新宿1-1-1"
                      value={formData.origin_address}
                      onChange={e => setFormData(p => ({ ...p, origin_address: e.target.value }))}
                      required />
                  </FormField>
                  <FormField label="引越し先（到着地）" required>
                    <input style={styles.input} type="text" placeholder="例：神奈川県横浜市中区山下町1-1"
                      value={formData.destination_address}
                      onChange={e => setFormData(p => ({ ...p, destination_address: e.target.value }))}
                      required />
                  </FormField>
                  <FormField label="引越し希望日">
                    <input style={styles.input} type="date"
                      value={formData.move_date}
                      onChange={e => setFormData(p => ({ ...p, move_date: e.target.value }))} />
                  </FormField>
                  <FormField label="世帯規模">
                    <select style={styles.input}
                      value={formData.household_size}
                      onChange={e => setFormData(p => ({ ...p, household_size: e.target.value }))}>
                      <option value="">選択してください</option>
                      <option value="単身">単身（1人）</option>
                      <option value="カップル・夫婦">カップル・夫婦（2人）</option>
                      <option value="ファミリー（3〜4人）">ファミリー（3〜4人）</option>
                      <option value="大家族（5人以上）">大家族（5人以上）</option>
                    </select>
                  </FormField>
                </div>
                <FormField label="特記事項・備考">
                  <textarea style={{ ...styles.input, minHeight: '80px', resize: 'vertical' }}
                    placeholder="例：ピアノあり、大型家具多め、急ぎ対応希望 など"
                    value={formData.special_notes}
                    onChange={e => setFormData(p => ({ ...p, special_notes: e.target.value }))} />
                </FormField>
                <button type="submit" style={styles.btnPrimary}>
                  🤖 AIに振分けを依頼する
                </button>
              </form>
            </div>
          )}

          {/* AI分析中 */}
          {step === STEP.RUNNING && (
            <div style={styles.card}>
              <div style={styles.loadingCenter}>
                <div style={styles.spinner} />
                <h2 style={{ marginTop: 16, color: '#2563eb' }}>AI分析中...</h2>
                <p style={{ color: '#6b7280', marginTop: 8 }}>店舗データを照合しています</p>
              </div>
              <LogPanel logs={logs} />
            </div>
          )}

          {/* 担当者確認 */}
          {step === STEP.CONFIRM && (
            <div style={styles.card}>
              <h2 style={styles.cardTitle}>👤 担当者確認</h2>
              <div style={styles.aiResultBox}>
                <div style={styles.aiResultLabel}>🤖 AIの推薦結果</div>
                <pre style={styles.aiResultText}>{aiResult || '（推薦結果を読み込み中...）'}</pre>
              </div>
              <form onSubmit={handleConfirmSubmit} style={{ marginTop: 20 }}>
                <FormField label="最終選択店舗を入力してください" required>
                  <input style={styles.input} type="text"
                    placeholder="例：ST01東京本店"
                    value={finalStore}
                    onChange={e => setFinalStore(e.target.value)}
                    required />
                </FormField>
                <button type="submit" style={styles.btnPrimary}>確定して次へ →</button>
              </form>
              <LogPanel logs={logs} />
            </div>
          )}

          {/* 店舗電話確認 */}
          {step === STEP.PHONE && (
            <div style={styles.card}>
              <h2 style={styles.cardTitle}>📞 店舗電話確認</h2>
              <div style={styles.infoBox}>
                <strong>送付先店舗：{finalStore}</strong> に電話してください。<br />
                対応可否を選択してください。
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
                <button style={styles.btnSuccess} onClick={() => handlePhoneSubmit('approve')}>
                  ✅ 対応可
                </button>
                <button style={styles.btnDanger} onClick={() => handlePhoneSubmit('reject')}>
                  ❌ 対応不可
                </button>
              </div>
              <LogPanel logs={logs} />
            </div>
          )}

          {/* 完了 */}
          {step === STEP.DONE && (
            <div style={styles.card}>
              <div style={styles.doneHeader}>
                <span style={styles.doneIcon}>✅</span>
                <h2 style={styles.cardTitle}>振分け完了！</h2>
              </div>
              <div style={styles.resultGrid}>
                <ResultItem label="担当店舗" value={outputData?.selected_store || finalStore} highlight />
                <ResultItem label="電話確認結果" value={phoneResult === 'approve' ? '対応可' : phoneResult === 'reject' ? '対応不可' : '-'} />
                <ResultItem label="お客様名" value={formData.customer_name} />
                <ResultItem label="引越し元" value={formData.origin_address} />
                <ResultItem label="引越し先" value={formData.destination_address} />
              </div>
              {aiResult && (
                <div style={{ ...styles.aiResultBox, marginTop: 16 }}>
                  <div style={styles.aiResultLabel}>🤖 AI推薦コメント</div>
                  <pre style={styles.aiResultText}>{aiResult}</pre>
                </div>
              )}
              <button style={{ ...styles.btnPrimary, marginTop: 20, background: '#16a34a' }} onClick={handleReset}>
                🔄 新しい案件を受け付ける
              </button>
              <LogPanel logs={logs} />
            </div>
          )}

          {/* エラー */}
          {step === STEP.ERROR && (
            <div style={styles.card}>
              <div style={styles.errorBox}>
                <h2>⚠️ エラーが発生しました</h2>
                <p style={{ marginTop: 8, wordBreak: 'break-all' }}>{errorMsg}</p>
              </div>
              <button style={{ ...styles.btnPrimary, marginTop: 20, background: '#dc2626' }} onClick={handleReset}>
                ← 最初からやり直す
              </button>
              <LogPanel logs={logs} />
            </div>
          )}
        </main>

        <footer style={styles.footer}>
          © 2026 リリーフ AI振分けシステム — 内部利用限定デモ
        </footer>
      </div>
    </>
  );
}

// ---- 共通コンポーネント ----
function FormField({ label, required, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={styles.label}>
        {label}{required && <span style={{ color: '#dc2626', marginLeft: 4 }}>*</span>}
      </label>
      {children}
    </div>
  );
}

function ResultItem({ label, value, highlight }) {
  return (
    <div style={{ ...styles.resultItem, ...(highlight ? styles.resultItemHighlight : {}) }}>
      <div style={styles.resultLabel}>{label}</div>
      <div style={styles.resultValue}>{value || '—'}</div>
    </div>
  );
}

function LogPanel({ logs }) {
  if (!logs.length) return null;
  return (
    <div style={styles.logPanel}>
      <div style={styles.logTitle}>📊 処理ログ</div>
      {logs.map((log, i) => (
        <div key={i} style={styles.logLine}>{log}</div>
      ))}
    </div>
  );
}

// ====== スタイル定義 ======
const styles = {
  wrapper: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: '#f0f4f8',
  },
  header: {
    background: 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%)',
    color: '#fff',
    padding: '0 24px',
    boxShadow: '0 2px 8px rgba(0,0,0,.15)',
  },
  headerInner: {
    maxWidth: 800,
    margin: '0 auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 0',
    flexWrap: 'wrap',
    gap: 12,
  },
  logo: { display: 'flex', alignItems: 'center', gap: 12 },
  logoIcon: { fontSize: 32 },
  logoTitle: { fontSize: 20, fontWeight: 700, letterSpacing: '.5px' },
  logoSub: { fontSize: 12, opacity: .8, marginTop: 2 },
  badge: {
    background: 'rgba(255,255,255,.15)',
    border: '1px solid rgba(255,255,255,.3)',
    borderRadius: 20,
    padding: '4px 14px',
    fontSize: 12,
    fontWeight: 600,
  },
  main: {
    flex: 1,
    maxWidth: 800,
    width: '100%',
    margin: '32px auto',
    padding: '0 16px',
  },
  card: {
    background: '#fff',
    borderRadius: 16,
    padding: '32px',
    boxShadow: '0 4px 24px rgba(0,0,0,.08)',
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: 700,
    color: '#1e3a8a',
    marginBottom: 8,
  },
  cardDesc: { color: '#6b7280', marginBottom: 24, fontSize: 14 },
  form: {},
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '0 24px',
  },
  label: {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    color: '#374151',
    marginBottom: 6,
  },
  input: {
    width: '100%',
    padding: '10px 14px',
    border: '1.5px solid #d1d5db',
    borderRadius: 8,
    fontSize: 14,
    color: '#1f2937',
    outline: 'none',
    transition: 'border-color .2s',
    fontFamily: 'inherit',
  },
  btnPrimary: {
    width: '100%',
    padding: '14px',
    background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
    marginTop: 8,
    letterSpacing: '.5px',
  },
  btnSuccess: {
    flex: 1,
    padding: '14px',
    background: '#16a34a',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
  },
  btnDanger: {
    flex: 1,
    padding: '14px',
    background: '#dc2626',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
  },
  loadingCenter: { textAlign: 'center', padding: '32px 0' },
  spinner: {
    width: 48,
    height: 48,
    border: '4px solid #e5e7eb',
    borderTop: '4px solid #2563eb',
    borderRadius: '50%',
    margin: '0 auto',
    animation: 'spin 1s linear infinite',
  },
  aiResultBox: {
    background: '#eff6ff',
    border: '1.5px solid #bfdbfe',
    borderRadius: 10,
    padding: '16px',
    marginTop: 8,
  },
  aiResultLabel: { fontSize: 12, fontWeight: 700, color: '#1d4ed8', marginBottom: 8 },
  aiResultText: {
    fontSize: 14,
    color: '#1e3a8a',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontFamily: 'inherit',
    lineHeight: 1.7,
  },
  infoBox: {
    background: '#fffbeb',
    border: '1.5px solid #fde68a',
    borderRadius: 10,
    padding: '16px',
    fontSize: 14,
    lineHeight: 1.7,
  },
  doneHeader: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 },
  doneIcon: { fontSize: 36 },
  resultGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: 12,
  },
  resultItem: {
    background: '#f9fafb',
    border: '1.5px solid #e5e7eb',
    borderRadius: 10,
    padding: '12px 16px',
  },
  resultItemHighlight: {
    background: '#eff6ff',
    border: '2px solid #2563eb',
  },
  resultLabel: { fontSize: 11, color: '#6b7280', fontWeight: 600, marginBottom: 4 },
  resultValue: { fontSize: 16, fontWeight: 700, color: '#1e3a8a' },
  errorBox: {
    background: '#fef2f2',
    border: '1.5px solid #fca5a5',
    borderRadius: 10,
    padding: '20px',
    color: '#dc2626',
  },
  logPanel: {
    marginTop: 24,
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: '12px 16px',
    maxHeight: 180,
    overflowY: 'auto',
  },
  logTitle: { fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 8 },
  logLine: { fontSize: 12, color: '#475569', lineHeight: 1.8 },
  footer: {
    textAlign: 'center',
    padding: '16px',
    color: '#9ca3af',
    fontSize: 12,
    borderTop: '1px solid #e5e7eb',
    background: '#fff',
  },
};
