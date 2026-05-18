import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, Phone, Activity, AlertTriangle, Bot, Zap, RefreshCw } from 'lucide-react';
import { socketService } from '../services/socket';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import ConfidenceBar from '../components/ui/ConfidenceBar';
import AgentAssistPanel from '../components/AgentAssistPanel';

// ─── SMALL ATOMS ─────────────────────────────────────────────────────────────

function RecordingDot({ active }) {
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
      background: active ? '#ef4444' : 'var(--border-bright)',
      animation: active ? 'pulse 2s infinite' : 'none',
    }} />
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', color: 'var(--text-secondary)', marginBottom: 10 }}>
      {children}
    </div>
  );
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────
export default function LiveCallPage() {
  // Call state
  const [isRecording, setIsRecording] = useState(false);
  const [callId, setCallId] = useState(null);
  
  // Content state
  const [transcript, setTranscript] = useState('');
  const [flags, setFlags] = useState([]);
  
  const [assistData, setAssistData] = useState(null);
  const [liveAnalysis, setLiveAnalysis] = useState(null);

  // Status for UI loading
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState('ok');

  // Refs — never trigger re-renders
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const recognitionRef = useRef(null);
  const liveTranscript = useRef(''); // always current, no closure staleness

  // ── Socket listeners ───────────────────────────────────────────────────────
  useEffect(() => {
    socketService.connect();

    socketService.socket.on('call:stream:transcript', ({ text }) => {
      // Backend transcript is fallback — prefer local SpeechRecognition
      if (!liveTranscript.current) {
        setTranscript(text);
        liveTranscript.current = text;
      }
    });

    socketService.socket.on('call:stream:agent_assist', (data) => {
      setAssistData(data);
    });

    socketService.socket.on('call:stream:analysis', (data) => {
      setLiveAnalysis(data);
    });
    
    socketService.socket.on('call:stream:flag', ({ flag }) =>
      setFlags(prev => [...new Set([...prev, flag])])
    );

    return () => {
      socketService.socket.off('call:stream:transcript');
      socketService.socket.off('call:stream:agent_assist');
      socketService.socket.off('call:stream:analysis');
      socketService.socket.off('call:stream:flag');
    };
  }, []);

  // ── Start call ─────────────────────────────────────────────────────────────
  const startCall = async () => {
    // Reset all content state first
    setTranscript('');
    setFlags([]);
    setAssistData(null);
    setLiveAnalysis(null);
    liveTranscript.current = '';

    const newCallId = `LIVE-${Date.now()}`;
    setCallId(newCallId);

    // 1. MediaRecorder → socket → backend Whisper pipeline
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = async ({ data }) => {
        if (data.size > 0)
          socketService.socket.emit('call:stream:audio', {
            callId: newCallId,
            audioChunk: await data.arrayBuffer(),
            mimeType: recorder.mimeType,
          });
      };
      // Emit end after final chunk — prevents race condition
      recorder.onstop = () => socketService.socket.emit('call:stream:end', { callId: newCallId });

      socketService.socket.emit('call:stream:start', { callId: newCallId });
      recorder.start(3000);
    } catch (err) {
      console.error('MediaRecorder failed:', err);
    }

    // 2. Web Speech API → local transcript fallback
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (SR) {
      const rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-US';
      rec.onresult = (event) => {
        const text = Array.from(event.results).map(r => r[0].transcript).join(' ').trim();
        setTranscript(text);
        liveTranscript.current = text;
      };
      rec.onerror = (e) => console.warn('SpeechRecognition:', e.error);
      rec.start();
      recognitionRef.current = rec;
    }

    setIsRecording(true);
  };

  // ── End call ───────────────────────────────────────────────────────────────
  const endCall = () => {
    if (mediaRecorderRef.current?.state !== 'inactive') mediaRecorderRef.current.stop();
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;

    recognitionRef.current?.stop();
    recognitionRef.current = null;

    setIsRecording(false);
    setCallId(null);
  };

  const handleAction = useCallback((action, intent) => {
    socketService.socket.emit('call:action:taken', { action, intent, callId, timestamp: Date.now() });
  }, [callId]);

  useEffect(() => () => {
    recognitionRef.current?.stop();
    streamRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 1100, margin: '0 auto' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h2 style={{
            margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text-primary)',
            display: 'flex', alignItems: 'center', gap: 9,
          }}>
            Live Call Governance
            <Activity size={18} color={isRecording ? '#ef4444' : 'var(--text-muted)'} />
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            Voice → Whisper → Server Agent Pipeline → Agent Assist
          </p>
        </div>

        <button
          onClick={isRecording ? endCall : startCall}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
            padding: '10px 20px', borderRadius: 8, border: 'none',
            cursor: 'pointer', fontWeight: 600, fontSize: 14,
            background: isRecording ? '#ef4444' : 'var(--accent-blue)',
            color: '#fff',
            boxShadow: isRecording
              ? '0 4px 12px rgba(239,68,68,0.3)'
              : '0 4px 12px rgba(37,99,235,0.3)',
          }}
        >
          {isRecording ? <Phone size={16} /> : <Mic size={16} />}
          {isRecording ? 'End Call' : 'Start Live Call'}
        </button>
      </div>

      {/* ── Body: Transcript (left wide) + Right column ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start' }}>

        {/* LEFT — Transcript */}
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <RecordingDot active={isRecording} />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', color: 'var(--text-secondary)' }}>
              LIVE TRANSCRIPT
            </span>
            {callId && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>· {callId}</span>
            )}
          </div>

          <div style={{
            minHeight: 300, background: 'var(--bg-secondary)', borderRadius: 8,
            padding: 16, fontSize: 14, color: 'var(--text-primary)',
            lineHeight: 1.7, border: '1px solid var(--border)',
          }}>
            {transcript || (
              <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                {isRecording ? 'Listening and verifying customer via Agent... ' : 'Click "Start Live Call" and begin speaking.'}
              </span>
            )}
          </div>
        </Card>

        {/* RIGHT — three stacked cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Governance Alerts */}
          <Card>
            <SectionLabel>GOVERNANCE ALERTS</SectionLabel>
            {flags.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {flags.map(flag => (
                  <motion.div
                    key={flag}
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 10px', borderRadius: 6,
                      background: 'rgba(239,68,68,0.08)',
                      border: '1px solid rgba(239,68,68,0.25)',
                    }}
                  >
                    <AlertTriangle size={13} color="#ef4444" />
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#ef4444' }}>{flag}</span>
                  </motion.div>
                ))}
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>No issues detected.</p>
            )}
          </Card>

          {/* Real-time Analysis */}
          <Card>
            <SectionLabel>REAL-TIME ANALYSIS</SectionLabel>
            {liveAnalysis ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>INTENT</div>
                  <Badge variant={liveAnalysis.intent}>{liveAnalysis.intent}</Badge>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>SENTIMENT</div>
                  <Badge variant={liveAnalysis.sentiment} dot>{liveAnalysis.sentiment}</Badge>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>CONFIDENCE</div>
                  <ConfidenceBar score={liveAnalysis.confidence || 0} />
                </div>
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Awaiting verification…</p>
            )}
          </Card>

          {/* Agent Assist */}
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <Bot size={13} color="var(--text-secondary)" />
              <SectionLabel style={{ marginBottom: 0 }}>AGENT ASSIST</SectionLabel>
            </div>
            <AgentAssistPanel
              assistData={assistData}
              isAnalyzing={isAnalyzing}
              ollamaStatus={ollamaStatus}
              onAction={handleAction}
            />
          </Card>

        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1);   opacity: 1; }
          50%       { transform: scale(1.5); opacity: 0.5; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}