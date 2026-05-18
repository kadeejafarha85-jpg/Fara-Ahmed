// src/components/AgentAssistPanel.jsx
// Renders differently based on verification stage:
//   UNVERIFIED / AWAITING_* → shows verification checklist + script
//   VERIFIED                → shows full agent assist (intent, script, action button)
//   FAILED                  → shows failure warning

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, ShieldX, ShieldAlert, Zap, RefreshCw, CheckCircle, XCircle, Circle } from 'lucide-react';
import Badge from './ui/Badge';
import ConfidenceBar from './ui/ConfidenceBar';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const VERIFICATION_STAGE = {
  UNVERIFIED:         'UNVERIFIED',
  AWAITING_NAME:      'AWAITING_NAME',
  AWAITING_ORDER:     'AWAITING_ORDER',
  AWAITING_EMAIL:     'AWAITING_EMAIL',
  PARTIALLY_VERIFIED: 'PARTIALLY_VERIFIED',
  VERIFIED:           'VERIFIED',
  FAILED:             'FAILED',
};

const ACTION_CONFIG = {
  ISSUE_REFUND:     { label: 'Process Quick Refund',    color: '#185FA5' },
  OFFER_RETENTION:  { label: 'Send 20% Loyalty Offer',  color: '#854F0B' },
  ESCALATE:         { label: 'Escalate to Manager',     color: '#A32D2D' },
  PROVIDE_TRACKING: { label: 'Share Tracking Info',     color: '#3B6D11' },
  UPDATE_ADDRESS:   { label: 'Update Delivery Address', color: '#534AB7' },
  EMPATHIZE:        { label: 'Log Empathy Interaction', color: '#993556' },
  PROVIDE_INFO:     { label: 'Pull Account Info',       color: '#3B6D11' },
  NONE:             { label: 'No Action Required',      color: '#5F5E5A' },
};

const VERIFICATION_FIELDS = ['name', 'orderId', 'email', 'phone'];

// ─── VERIFICATION CHECKLIST ───────────────────────────────────────────────────
function VerificationChecklist({ matchedFields = [], mismatchedFields = [] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {VERIFICATION_FIELDS.map(field => {
        const matched    = matchedFields.includes(field);
        const mismatched = mismatchedFields.includes(field);
        return (
          <div key={field} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 10px', borderRadius: 6,
            background: matched
              ? 'rgba(99,153,34,0.08)'
              : mismatched
                ? 'rgba(239,68,68,0.08)'
                : 'var(--bg-secondary)',
            border: `1px solid ${matched ? 'rgba(99,153,34,0.25)' : mismatched ? 'rgba(239,68,68,0.25)' : 'var(--border)'}`,
          }}>
            {matched
              ? <CheckCircle size={13} color="#639922" />
              : mismatched
                ? <XCircle size={13} color="#ef4444" />
                : <Circle size={13} color="var(--text-muted)" />
            }
            <span style={{
              fontSize: 12, fontWeight: 500, textTransform: 'capitalize',
              color: matched ? '#639922' : mismatched ? '#ef4444' : 'var(--text-muted)',
            }}>
              {field === 'orderId' ? 'Order ID' : field.charAt(0).toUpperCase() + field.slice(1)}
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)' }}>
              {matched ? 'Confirmed' : mismatched ? 'Mismatch' : 'Pending'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── STAGE HEADER ─────────────────────────────────────────────────────────────
function StageHeader({ stage }) {
  const config = {
    [VERIFICATION_STAGE.UNVERIFIED]:         { icon: <ShieldAlert size={14} />, label: 'Identity Not Verified',   color: '#BA7517', bg: 'rgba(186,117,23,0.1)'  },
    [VERIFICATION_STAGE.AWAITING_NAME]:      { icon: <ShieldAlert size={14} />, label: 'Awaiting Name',           color: '#BA7517', bg: 'rgba(186,117,23,0.1)'  },
    [VERIFICATION_STAGE.AWAITING_ORDER]:     { icon: <ShieldAlert size={14} />, label: 'Awaiting Order ID',       color: '#BA7517', bg: 'rgba(186,117,23,0.1)'  },
    [VERIFICATION_STAGE.AWAITING_EMAIL]:     { icon: <ShieldAlert size={14} />, label: 'Awaiting Email',          color: '#BA7517', bg: 'rgba(186,117,23,0.1)'  },
    [VERIFICATION_STAGE.PARTIALLY_VERIFIED]: { icon: <ShieldAlert size={14} />, label: 'Partially Verified',      color: '#854F0B', bg: 'rgba(133,79,11,0.1)'   },
    [VERIFICATION_STAGE.VERIFIED]:           { icon: <ShieldCheck size={14} />, label: 'Customer Verified ✓',     color: '#3B6D11', bg: 'rgba(59,109,17,0.1)'   },
    [VERIFICATION_STAGE.FAILED]:             { icon: <ShieldX    size={14} />, label: 'Verification Failed',     color: '#A32D2D', bg: 'rgba(162,45,45,0.1)'   },
  }[stage] ?? { icon: <ShieldAlert size={14} />, label: stage, color: '#5F5E5A', bg: 'var(--bg-secondary)' };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 7,
      padding: '7px 10px', borderRadius: 6,
      background: config.bg, color: config.color,
      fontSize: 12, fontWeight: 600,
    }}>
      {config.icon}
      {config.label}
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function AgentAssistPanel({ assistData, isAnalyzing, ollamaStatus, onAction }) {
  const [actionLogged, setActionLogged] = useState(null);
  useEffect(() => { setActionLogged(null); }, [assistData]);

  // ── Loading ──────────────────────────────────────────────────────────────
  if (isAnalyzing && !assistData) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '18px 0' }}>
      <RefreshCw size={15} color="var(--text-muted)" style={{ animation: 'spin 1s linear infinite' }} />
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Analyzing…</span>
    </div>
  );

  // ── Empty ────────────────────────────────────────────────────────────────
  if (!assistData) return (
    <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>
      Awaiting transcript data…
    </p>
  );

  const { verificationStage, agentScript, matchedFields, mismatchedFields,
          nextStep, confidenceScore, intent, sentiment, confidence,
          summary, agentAction, flags, governance } = assistData;

  const isVerified = verificationStage === VERIFICATION_STAGE.VERIFIED;
  const isFailed   = verificationStage === VERIFICATION_STAGE.FAILED;
  const action     = ACTION_CONFIG[agentAction] ?? ACTION_CONFIG.NONE;
  const isOk       = ollamaStatus === 'ok';

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={verificationStage + (intent ?? '')}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        {/* Ollama status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: isOk ? '#639922' : '#BA7517', flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {isOk ? 'Ollama connected' : 'Demo mode'}
          </span>
        </div>

        {/* Verification stage badge */}
        <StageHeader stage={verificationStage} />

        {/* ── PRE-VERIFICATION VIEW ── */}
        {!isVerified && !isFailed && (
          <>
            <VerificationChecklist
              matchedFields={matchedFields ?? []}
              mismatchedFields={mismatchedFields ?? []}
            />
            {confidenceScore != null && (
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>MATCH CONFIDENCE</div>
                <ConfidenceBar score={confidenceScore} />
              </div>
            )}
          </>
        )}

        {/* ── FAILED VIEW ── */}
        {isFailed && (
          <div style={{
            padding: '10px 12px', borderRadius: 6,
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.3)',
            fontSize: 13, color: '#ef4444', lineHeight: 1.5,
          }}>
            ⚠ Customer could not be verified. Do not share account information.
            Consider escalating to a supervisor.
          </div>
        )}

        {/* ── VERIFIED: INTENT + SENTIMENT ── */}
        {isVerified && intent && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>INTENT</div>
              <Badge variant={intent}>{intent.replace(/_/g, ' ')}</Badge>
            </div>
            {sentiment && (
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>SENTIMENT</div>
                <Badge variant={sentiment} dot>{sentiment.replace(/_/g, ' ')}</Badge>
              </div>
            )}
          </div>
        )}

        {/* ── VERIFIED: CONFIDENCE ── */}
        {isVerified && confidence != null && (
          <ConfidenceBar score={confidence} />
        )}

        {/* ── AI SUMMARY (both states) ── */}
        {summary && (
          <div style={{
            background: 'var(--bg-secondary)', borderRadius: 6, padding: '9px 11px',
            fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6,
            borderLeft: `3px solid ${isVerified ? 'var(--accent-blue)' : '#BA7517'}`,
          }}>
            {summary}
          </div>
        )}

        {/* ── AGENT SCRIPT (always shown) ── */}
        {agentScript && (
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 5 }}>
              {isVerified ? 'SUGGESTED RESPONSE' : 'VERIFICATION SCRIPT'}
            </div>
            <div style={{
              background: 'var(--bg-secondary)', borderRadius: 6, padding: '9px 11px',
              fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.7,
              fontStyle: 'italic',
              borderLeft: `3px solid ${isVerified ? '#639922' : '#BA7517'}`,
            }}>
              "{agentScript}"
            </div>
          </div>
        )}

        {/* ── GOVERNANCE NOTE ── */}
        {governance?.complianceNote && (
          <div style={{
            padding: '8px 10px', borderRadius: 6, fontSize: 12,
            background: 'rgba(239,68,68,0.08)', color: '#ef4444',
            border: '1px solid rgba(239,68,68,0.25)',
          }}>
            ⚑ {governance.complianceNote}
          </div>
        )}

        {/* ── ACTION BUTTON (verified only) ── */}
        {isVerified && agentAction && agentAction !== 'NONE' && (
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => {
              setActionLogged(action.label);
              onAction(agentAction, intent, assistData.actionPayload);
            }}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              padding: '9px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: 600, transition: 'background 0.2s',
              background: actionLogged ? '#EAF3DE' : action.color,
              color:      actionLogged ? '#3B6D11'  : '#fff',
            }}
          >
            <Zap size={13} />
            {actionLogged ? `✓ ${actionLogged} logged` : action.label}
          </motion.button>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
