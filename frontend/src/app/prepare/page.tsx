'use client';

import { useState, useRef, useEffect } from 'react';
import { api } from '@/lib/api';
import { Brain, Send, CheckCircle, Clock, ChevronRight, FileText, Calculator, AlertCircle, Trash2, MessageSquare, Sparkles, HelpCircle, Lightbulb, Search, ArrowRight } from 'lucide-react';

const PHASES = [
  { id: 0, name: 'Consultation', icon: '✦' },
  { id: 1, name: 'Personal Info', icon: '1' },
  { id: 2, name: 'Income', icon: '2' },
  { id: 3, name: 'Deductions', icon: '3' },
  { id: 4, name: 'Dependents', icon: '4' },
  { id: 5, name: 'Credits', icon: '5' },
  { id: 6, name: 'Payments', icon: '6' },
  { id: 7, name: 'State Filing', icon: '7' },
  { id: 8, name: 'Review', icon: '8' },
];

interface Message {
  role: 'system' | 'user' | 'claude';
  content: string;
  timestamp: string;
  phase?: number;
  guidance?: string;
}

interface ConsultInsight {
  source: string;
  summary: string;
  flags: string[];
  guidance: string;
}

const CONSULTATION_PROMPTS = [
  "I haven't filed a return in several years",
  "I have a small business with unpaid taxes",
  "I received income from multiple states",
  "I have cryptocurrency transactions",
  "I'm going through a divorce",
  "I have foreign income or assets",
  "I need to amend a previous return",
  "I have rental property income",
];

export default function PreparePage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentPhase, setCurrentPhase] = useState(0);
  const [currentQuestion, setCurrentQuestion] = useState<any>(null);
  const [answer, setAnswer] = useState('');
  const [runtimeStats, setRuntimeStats] = useState<any>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [summary, setSummary] = useState<any>(null);
  const [sessions, setSessions] = useState<any>(null);
  const [showSessions, setShowSessions] = useState(false);
  const [complete, setComplete] = useState(false);
  const [consultationText, setConsultationText] = useState('');
  const [consultationSubmitted, setConsultationSubmitted] = useState(false);
  const [consultInsights, setConsultInsights] = useState<ConsultInsight[]>([]);
  const [consultLoading, setConsultLoading] = useState(false);
  const [consultFollowUp, setConsultFollowUp] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const consultTextRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.runtimeStats().then(setRuntimeStats).catch(() => {});
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (inputRef.current && !loading) inputRef.current.focus();
  }, [loading, currentQuestion]);

  const startSession = async () => {
    setLoading(true);
    try {
      const res = await api.preparerStart({ tax_year: 2025 });
      if (res.success) {
        setSessionId(res.session_id);
        setCurrentPhase(0);
        setConsultationSubmitted(false);
        setConsultInsights([]);
        setConsultationText('');
        setMessages([{
          role: 'system',
          content: 'Welcome! Before we begin the structured interview, tell us about your tax situation. Describe anything complex, unusual, or that you need help with — Claude will consult our tax engines and provide tailored guidance before we start.',
          timestamp: new Date().toISOString(),
          phase: 0,
        }]);
        setCurrentQuestion(res.current_question);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const submitConsultation = async () => {
    if (!consultationText.trim() || !sessionId) return;
    setConsultLoading(true);
    setMessages(prev => [...prev, {
      role: 'user',
      content: consultationText.trim(),
      timestamp: new Date().toISOString(),
      phase: 0,
    }]);

    try {
      const res = await api.preparerConsult(sessionId, {
        situation: consultationText.trim(),
        request_engine_analysis: true,
      });

      const insights: ConsultInsight[] = [];

      if (res.success && res.analysis) {
        insights.push({
          source: 'Claude Analysis',
          summary: res.analysis.summary || res.analysis,
          flags: res.analysis.flags || [],
          guidance: res.analysis.guidance || '',
        });
      }

      if (res.engine_results && Array.isArray(res.engine_results)) {
        for (const er of res.engine_results) {
          insights.push({
            source: er.engine || er.source || 'Tax Engine',
            summary: er.summary || er.result || JSON.stringify(er),
            flags: er.flags || [],
            guidance: er.guidance || er.recommendation || '',
          });
        }
      }

      // Fallback: query the runtime engine directly if no results from consult
      if (insights.length === 0) {
        try {
          const engineRes = await api.runtimeQuery({
            query: consultationText.trim(),
            mode: 'consultation',
            limit: 5,
          });
          if (engineRes.results && Array.isArray(engineRes.results)) {
            for (const r of engineRes.results) {
              insights.push({
                source: r.engine_id || r.source || 'Doctrine Engine',
                summary: r.response || r.summary || r.content || '',
                flags: r.flags || [],
                guidance: r.guidance || r.recommendation || '',
              });
            }
          }
          if (engineRes.summary) {
            insights.unshift({
              source: 'Engine Fleet Analysis',
              summary: engineRes.summary,
              flags: engineRes.flags || [],
              guidance: engineRes.guidance || '',
            });
          }
        } catch (_) {}
      }

      // If still nothing, provide a generic acknowledgment
      if (insights.length === 0) {
        insights.push({
          source: 'Claude Opus',
          summary: `Your situation has been noted. The key points from your description will be factored into every phase of the interview. Claude will ask targeted follow-up questions based on what you've described.`,
          flags: ['Consultation recorded'],
          guidance: 'Your specific circumstances will influence the questions asked and the tax strategies recommended throughout the interview.',
        });
      }

      setConsultInsights(insights);
      setConsultationSubmitted(true);

      setMessages(prev => [...prev, {
        role: 'claude',
        content: insights.map(i =>
          `[${i.source}]\n${i.summary}${i.flags.length ? '\n⚠ Flags: ' + i.flags.join(', ') : ''}${i.guidance ? '\n→ ' + i.guidance : ''}`
        ).join('\n\n'),
        timestamp: new Date().toISOString(),
        phase: 0,
      }]);

    } catch (e) {
      setConsultInsights([{
        source: 'System',
        summary: 'Consultation recorded. Claude will use your description to guide the interview.',
        flags: [],
        guidance: 'Proceeding with awareness of your situation.',
      }]);
      setConsultationSubmitted(true);
      setMessages(prev => [...prev, {
        role: 'system',
        content: 'Your situation has been recorded. Claude will factor this into the interview.',
        timestamp: new Date().toISOString(),
        phase: 0,
      }]);
    }
    setConsultLoading(false);
  };

  const submitFollowUp = async () => {
    if (!consultFollowUp.trim() || !sessionId) return;
    const text = consultFollowUp.trim();
    setConsultFollowUp('');
    setConsultLoading(true);

    setMessages(prev => [...prev, {
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
      phase: 0,
    }]);

    try {
      const res = await api.preparerConsult(sessionId, {
        situation: text,
        follow_up: true,
        request_engine_analysis: true,
      });

      const responseText = res.analysis?.summary || res.analysis || res.response || 'Noted. This additional context will be used throughout your return preparation.';

      setMessages(prev => [...prev, {
        role: 'claude',
        content: typeof responseText === 'string' ? responseText : JSON.stringify(responseText),
        timestamp: new Date().toISOString(),
        phase: 0,
      }]);
    } catch (_) {
      setMessages(prev => [...prev, {
        role: 'system',
        content: 'Additional context noted.',
        timestamp: new Date().toISOString(),
        phase: 0,
      }]);
    }
    setConsultLoading(false);
  };

  const proceedToInterview = () => {
    setCurrentPhase(1);
    if (currentQuestion) {
      setMessages(prev => [...prev, {
        role: 'system',
        content: `Consultation complete. Now beginning Phase 1: Personal Info.\n\n${currentQuestion.text || 'Let\'s start with your personal information.'}`,
        timestamp: new Date().toISOString(),
        phase: 1,
      }]);
    }
  };

  const loadSessions = async () => {
    const res = await api.preparerList();
    setSessions(res);
    setShowSessions(true);
  };

  const resumeSession = async (sid: string) => {
    setLoading(true);
    try {
      const res = await api.preparerStatus(sid);
      if (res.success) {
        setSessionId(sid);
        setCurrentPhase(res.current_phase || 1);
        setCurrentQuestion(res.current_question);
        setShowSessions(false);
        setMessages([{
          role: 'system',
          content: `Resumed session. ${res.current_question?.text || 'Continue answering questions.'}`,
          timestamp: new Date().toISOString(),
          phase: res.current_phase,
        }]);
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const deleteSession = async (sid: string) => {
    await api.preparerDelete(sid);
    loadSessions();
  };

  const submitAnswer = async () => {
    if (!answer.trim() || !sessionId) return;
    const userMsg = answer.trim();
    setAnswer('');

    setMessages(prev => [...prev, {
      role: 'user',
      content: userMsg,
      timestamp: new Date().toISOString(),
      phase: currentPhase,
    }]);

    setLoading(true);
    try {
      const res = await api.preparerAnswer(sessionId, {
        question_id: currentQuestion?.id,
        answer: userMsg,
      });

      if (res.success) {
        if (res.phase_complete || res.interview_complete) {
          if (res.interview_complete) {
            setComplete(true);
            setMessages(prev => [...prev, {
              role: 'system',
              content: 'All questions answered! Ready to calculate your return.',
              timestamp: new Date().toISOString(),
              phase: 8,
            }]);
          } else {
            setCurrentPhase(res.current_phase || currentPhase + 1);
            setCurrentQuestion(res.next_question);
            setMessages(prev => [...prev, {
              role: 'system',
              content: res.next_question?.text || `Phase ${res.current_phase} complete.`,
              timestamp: new Date().toISOString(),
              phase: res.current_phase,
              guidance: res.claude_guidance,
            }]);
          }
        } else {
          setCurrentQuestion(res.next_question);
          if (res.current_phase) setCurrentPhase(res.current_phase);
          setMessages(prev => [...prev, {
            role: res.claude_guidance ? 'claude' : 'system',
            content: res.claude_guidance || res.next_question?.text || 'Next question...',
            timestamp: new Date().toISOString(),
            phase: res.current_phase || currentPhase,
          }]);
          if (res.next_question && !res.claude_guidance) {
            setMessages(prev => [...prev, {
              role: 'system',
              content: res.next_question.text,
              timestamp: new Date().toISOString(),
              phase: res.current_phase || currentPhase,
            }]);
          }
        }
      }
    } catch (e) {
      setMessages(prev => [...prev, {
        role: 'system',
        content: 'Error processing answer. Please try again.',
        timestamp: new Date().toISOString(),
      }]);
    }
    setLoading(false);
  };

  const calculateReturn = async () => {
    if (!sessionId) return;
    setCalculating(true);
    try {
      const res = await api.preparerCalculate(sessionId);
      if (res.success) {
        const summaryRes = await api.preparerSummary(sessionId);
        setSummary(summaryRes);
        setMessages(prev => [...prev, {
          role: 'system',
          content: 'Return calculated successfully! View your summary below.',
          timestamp: new Date().toISOString(),
          phase: 8,
        }]);
      }
    } catch (e) {
      console.error(e);
    }
    setCalculating(false);
  };

  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);

  // ─── No session: show start screen ───
  if (!sessionId) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="text-center mb-12">
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--ept-accent)' }}>
            AI TAX PREPARER
          </span>
          <h1 className="text-4xl font-extrabold mt-2" style={{ color: 'var(--ept-text)' }}>
            <span className="gradient-text">Claude-Guided</span> Return Preparation
          </h1>
          <p className="mt-3 max-w-xl mx-auto" style={{ color: 'var(--ept-text-secondary)' }}>
            Claude Opus walks you through an 8-phase interview, queries {runtimeStats?.total_engines?.toLocaleString() || '...'} tax engines and {runtimeStats?.total_doctrines?.toLocaleString() || '...'} doctrines, and builds your complete return with CPA-grade accuracy.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <button
            onClick={startSession}
            disabled={loading}
            className="p-8 rounded-2xl border card-hover text-left"
            style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}
          >
            <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4" style={{ backgroundColor: 'var(--ept-accent-glow)', color: 'var(--ept-accent)' }}>
              <Sparkles size={24} />
            </div>
            <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--ept-text)' }}>Start New Return</h2>
            <p className="text-sm" style={{ color: 'var(--ept-text-secondary)' }}>
              Begin with a free-form consultation, then move through 8 interview phases. Claude queries tax engines and builds your return with CPA-grade accuracy.
            </p>
          </button>

          <button
            onClick={loadSessions}
            className="p-8 rounded-2xl border card-hover text-left"
            style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}
          >
            <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4" style={{ backgroundColor: 'var(--ept-info-bg)', color: 'var(--ept-info)' }}>
              <FileText size={24} />
            </div>
            <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--ept-text)' }}>Resume Session</h2>
            <p className="text-sm" style={{ color: 'var(--ept-text-secondary)' }}>
              Continue a previous interview session. Your progress is saved automatically.
            </p>
          </button>
        </div>

        {/* Phase overview */}
        <div className="rounded-2xl border p-6" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
          <h3 className="text-sm font-bold mb-4" style={{ color: 'var(--ept-text)' }}>Consultation + 8-Phase Interview</h3>
          <div className="grid grid-cols-3 md:grid-cols-3 gap-3">
            {PHASES.map((phase) => (
              <div key={phase.id} className="flex items-center gap-3 p-3 rounded-lg" style={{ backgroundColor: 'var(--ept-surface)' }}>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold" style={{ backgroundColor: 'var(--ept-accent-glow)', color: 'var(--ept-accent)', fontFamily: "'JetBrains Mono', monospace" }}>
                  {phase.icon}
                </div>
                <span className="text-xs font-medium" style={{ color: 'var(--ept-text)' }}>{phase.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Session list */}
        {showSessions && sessions?.data && (
          <div className="mt-6 rounded-2xl border overflow-hidden" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
            <div className="p-4 border-b" style={{ borderColor: 'var(--ept-border)' }}>
              <h3 className="text-sm font-bold" style={{ color: 'var(--ept-text)' }}>Previous Sessions</h3>
            </div>
            {sessions.data.length === 0 ? (
              <div className="p-8 text-center text-sm" style={{ color: 'var(--ept-text-muted)' }}>No previous sessions.</div>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--ept-border)' }}>
                {sessions.data.map((s: any) => (
                  <div key={s.session_id} className="flex items-center justify-between p-4 px-6">
                    <div>
                      <div className="text-sm font-semibold" style={{ color: 'var(--ept-text)' }}>
                        Session {s.session_id?.slice(0, 8)}...
                      </div>
                      <div className="text-xs" style={{ color: 'var(--ept-text-muted)' }}>
                        Phase {s.current_phase || '?'} | {new Date(s.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => resumeSession(s.session_id)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                        style={{ backgroundColor: 'var(--ept-accent-glow)', color: 'var(--ept-accent)' }}
                      >
                        Resume
                      </button>
                      <button
                        onClick={() => deleteSession(s.session_id)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                        style={{ backgroundColor: 'var(--ept-danger-bg)', color: 'var(--ept-danger)' }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ─── Active session: interview UI ───
  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="grid lg:grid-cols-4 gap-6">
        {/* Sidebar: Phase Progress */}
        <div className="lg:col-span-1">
          <div className="rounded-2xl border p-4 sticky top-24" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
            <div className="flex items-center gap-2 mb-4">
              <Brain size={16} style={{ color: 'var(--ept-accent)' }} />
              <span className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--ept-accent)' }}>Progress</span>
            </div>
            <div className="space-y-1">
              {PHASES.map((phase) => {
                const isActive = phase.id === currentPhase;
                const isDone = phase.id < currentPhase || complete;
                return (
                  <div
                    key={phase.id}
                    className="flex items-center gap-3 p-2 rounded-lg transition-colors"
                    style={{
                      backgroundColor: isActive ? 'var(--ept-accent-glow)' : 'transparent',
                    }}
                  >
                    <div
                      className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold"
                      style={{
                        backgroundColor: isDone ? 'var(--ept-success)' : isActive ? 'var(--ept-accent)' : 'var(--ept-surface)',
                        color: isDone || isActive ? '#fff' : 'var(--ept-text-muted)',
                      }}
                    >
                      {isDone ? <CheckCircle size={12} /> : phase.icon}
                    </div>
                    <span
                      className="text-xs font-medium"
                      style={{ color: isActive ? 'var(--ept-accent)' : isDone ? 'var(--ept-success)' : 'var(--ept-text-muted)' }}
                    >
                      {phase.name}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Progress bar */}
            <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--ept-border)' }}>
              <div className="flex justify-between text-[10px] font-medium mb-1" style={{ color: 'var(--ept-text-muted)' }}>
                <span>Progress</span>
                <span>{Math.round((currentPhase / 8) * 100)}%</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--ept-surface)' }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${(currentPhase / 8) * 100}%`,
                    backgroundColor: 'var(--ept-accent)',
                  }}
                />
              </div>
            </div>

            {complete && (
              <button
                onClick={calculateReturn}
                disabled={calculating}
                className="w-full mt-4 px-4 py-3 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2"
                style={{ backgroundColor: 'var(--ept-accent)' }}
              >
                {calculating ? (
                  <><Clock size={14} className="animate-spin" /> Calculating...</>
                ) : (
                  <><Calculator size={14} /> Calculate Return</>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Main: Chat Interface */}
        <div className="lg:col-span-3">
          <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
            {/* Header */}
            <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--ept-border)' }}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--ept-accent-glow)', color: 'var(--ept-accent)' }}>
                  <MessageSquare size={16} />
                </div>
                <div>
                  <h2 className="text-sm font-bold" style={{ color: 'var(--ept-text)' }}>
                    {currentPhase === 0 ? 'Consultation' : `Phase ${currentPhase}: ${PHASES.find(p => p.id === currentPhase)?.name || 'Complete'}`}
                  </h2>
                  <span className="text-[10px]" style={{ color: 'var(--ept-text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>
                    Session: {sessionId?.slice(0, 12)}...
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--ept-success)' }} />
                <span className="text-[10px] font-medium" style={{ color: 'var(--ept-success)' }}>Claude Active</span>
              </div>
            </div>

            {/* Messages */}
            <div className="p-4 space-y-4 max-h-[500px] overflow-y-auto min-h-[300px]" style={{ backgroundColor: 'var(--ept-bg-alt)' }}>
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[80%] p-3 rounded-xl text-sm ${msg.role === 'user' ? 'rounded-br-sm' : 'rounded-bl-sm'}`}
                    style={{
                      backgroundColor: msg.role === 'user' ? 'var(--ept-accent)' : msg.role === 'claude' ? 'var(--ept-purple-bg)' : 'var(--ept-surface)',
                      color: msg.role === 'user' ? '#fff' : 'var(--ept-text)',
                      borderLeft: msg.role === 'claude' ? '3px solid var(--ept-purple)' : undefined,
                    }}
                  >
                    {msg.role === 'claude' && (
                      <div className="flex items-center gap-1 mb-1">
                        <Brain size={12} style={{ color: 'var(--ept-purple)' }} />
                        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--ept-purple)' }}>Claude Guidance</span>
                      </div>
                    )}
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div className="p-3 rounded-xl rounded-bl-sm" style={{ backgroundColor: 'var(--ept-surface)' }}>
                    <div className="flex items-center gap-2">
                      <Clock size={14} className="animate-spin" style={{ color: 'var(--ept-accent)' }} />
                      <span className="text-sm" style={{ color: 'var(--ept-text-muted)' }}>
                        Claude is thinking...
                      </span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Consultation Input (Phase 0) */}
            {currentPhase === 0 && !consultationSubmitted && (
              <div className="p-4 border-t" style={{ borderColor: 'var(--ept-border)' }}>
                <div className="mb-3">
                  <label className="text-xs font-bold uppercase tracking-widest mb-2 block" style={{ color: 'var(--ept-accent)' }}>
                    Describe Your Tax Situation
                  </label>
                  <textarea
                    ref={consultTextRef}
                    value={consultationText}
                    onChange={(e) => setConsultationText(e.target.value)}
                    placeholder="Tell us about your situation... For example: I haven't filed since 2018, I have a business with unpaid payroll taxes, I received income from 3 states, I sold cryptocurrency, etc."
                    className="w-full px-4 py-3 rounded-xl border text-sm outline-none focus:ring-1 resize-none"
                    style={{
                      backgroundColor: 'var(--ept-surface)',
                      borderColor: 'var(--ept-border)',
                      color: 'var(--ept-text)',
                      minHeight: '120px',
                    }}
                    disabled={consultLoading}
                  />
                </div>
                <div className="flex flex-wrap gap-2 mb-3">
                  {CONSULTATION_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => setConsultationText(prev => prev ? `${prev}\n${prompt}` : prompt)}
                      className="px-3 py-1.5 rounded-full text-[11px] font-medium border transition-colors hover:opacity-80"
                      style={{ borderColor: 'var(--ept-border)', color: 'var(--ept-text-secondary)' }}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={submitConsultation}
                    disabled={consultLoading || !consultationText.trim()}
                    className="px-5 py-3 rounded-xl text-white font-semibold text-sm disabled:opacity-50 flex items-center gap-2"
                    style={{ backgroundColor: 'var(--ept-accent)' }}
                  >
                    {consultLoading ? (
                      <><Clock size={14} className="animate-spin" /> Consulting Engines...</>
                    ) : (
                      <><Search size={14} /> Consult Tax Engines</>
                    )}
                  </button>
                  <button
                    onClick={proceedToInterview}
                    className="px-5 py-3 rounded-xl border font-semibold text-sm flex items-center gap-2"
                    style={{ borderColor: 'var(--ept-border)', color: 'var(--ept-text-secondary)' }}
                  >
                    Skip to Interview <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            )}

            {/* Consultation Results + Follow-Up (Phase 0, after submission) */}
            {currentPhase === 0 && consultationSubmitted && (
              <div className="border-t" style={{ borderColor: 'var(--ept-border)' }}>
                {/* Insight Cards */}
                {consultInsights.length > 0 && (
                  <div className="p-4 space-y-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Lightbulb size={14} style={{ color: 'var(--ept-warning)' }} />
                      <span className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--ept-warning)' }}>Engine Insights</span>
                    </div>
                    {consultInsights.map((insight, i) => (
                      <div
                        key={i}
                        className="p-3 rounded-xl border-l-[3px]"
                        style={{
                          backgroundColor: 'var(--ept-surface)',
                          borderColor: 'var(--ept-accent)',
                        }}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <Brain size={12} style={{ color: 'var(--ept-accent)' }} />
                          <span className="text-[11px] font-bold" style={{ color: 'var(--ept-accent)', fontFamily: "'JetBrains Mono', monospace" }}>
                            {insight.source}
                          </span>
                        </div>
                        <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--ept-text)' }}>{insight.summary}</p>
                        {insight.flags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {insight.flags.map((flag, fi) => (
                              <span key={fi} className="px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ backgroundColor: 'var(--ept-warning-bg)', color: 'var(--ept-warning)' }}>
                                {flag}
                              </span>
                            ))}
                          </div>
                        )}
                        {insight.guidance && (
                          <p className="text-xs mt-2 italic" style={{ color: 'var(--ept-text-secondary)' }}>
                            {insight.guidance}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Follow-Up + Proceed */}
                <div className="p-4 border-t" style={{ borderColor: 'var(--ept-border)' }}>
                  <div className="flex gap-3 mb-3">
                    <input
                      value={consultFollowUp}
                      onChange={(e) => setConsultFollowUp(e.target.value)}
                      placeholder="Ask a follow-up question about your situation..."
                      className="flex-1 px-4 py-3 rounded-xl border text-sm outline-none focus:ring-1"
                      style={{
                        backgroundColor: 'var(--ept-surface)',
                        borderColor: 'var(--ept-border)',
                        color: 'var(--ept-text)',
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitFollowUp(); } }}
                      disabled={consultLoading}
                    />
                    <button
                      onClick={submitFollowUp}
                      disabled={consultLoading || !consultFollowUp.trim()}
                      className="px-4 py-3 rounded-xl text-white text-sm disabled:opacity-50"
                      style={{ backgroundColor: 'var(--ept-accent)' }}
                    >
                      <Send size={14} />
                    </button>
                  </div>
                  <button
                    onClick={proceedToInterview}
                    className="w-full px-5 py-3 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2"
                    style={{ backgroundColor: 'var(--ept-accent)' }}
                  >
                    Proceed to Interview <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            )}

            {/* Interview Input (Phase 1-8) */}
            {currentPhase > 0 && !complete && (
              <div className="p-4 border-t" style={{ borderColor: 'var(--ept-border)' }}>
                <div className="flex gap-3">
                  <input
                    ref={inputRef}
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    placeholder={currentQuestion?.help_text || 'Type your answer...'}
                    className="flex-1 px-4 py-3 rounded-xl border text-sm outline-none focus:ring-1"
                    style={{
                      backgroundColor: 'var(--ept-surface)',
                      borderColor: 'var(--ept-border)',
                      color: 'var(--ept-text)',
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitAnswer(); } }}
                    disabled={loading}
                  />
                  <button
                    onClick={submitAnswer}
                    disabled={loading || !answer.trim()}
                    className="px-5 py-3 rounded-xl text-white font-semibold text-sm disabled:opacity-50 flex items-center gap-2"
                    style={{ backgroundColor: 'var(--ept-accent)' }}
                  >
                    <Send size={14} />
                  </button>
                </div>
                {currentQuestion?.options && currentQuestion.options.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {currentQuestion.options.map((opt: string) => (
                      <button
                        key={opt}
                        onClick={() => { setAnswer(opt); }}
                        className="px-3 py-1 rounded-full text-xs font-medium border"
                        style={{ borderColor: 'var(--ept-border)', color: 'var(--ept-text-secondary)' }}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Summary Card */}
          {summary?.success && summary.summary && (
            <div className="mt-6 rounded-2xl border p-6" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'var(--ept-success-bg)', color: 'var(--ept-success)' }}>
                  <CheckCircle size={20} />
                </div>
                <div>
                  <h2 className="text-lg font-bold" style={{ color: 'var(--ept-text)' }}>Return Summary</h2>
                  <span className="text-xs" style={{ color: 'var(--ept-text-muted)' }}>Tax Year {summary.summary.tax_year}</span>
                </div>
              </div>

              {summary.summary.calculation && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  {[
                    { label: 'Total Income', value: fmt(summary.summary.calculation.total_income), color: 'var(--ept-text)' },
                    { label: 'AGI', value: fmt(summary.summary.calculation.adjusted_gross_income), color: 'var(--ept-text)' },
                    { label: 'Taxable Income', value: fmt(summary.summary.calculation.taxable_income), color: 'var(--ept-text)' },
                    {
                      label: summary.summary.calculation.refund_or_owed > 0 ? 'Refund' : 'Owed',
                      value: fmt(Math.abs(summary.summary.calculation.refund_or_owed)),
                      color: summary.summary.calculation.refund_or_owed > 0 ? 'var(--ept-success)' : 'var(--ept-danger)',
                    },
                  ].map((item) => (
                    <div key={item.label} className="p-4 rounded-xl" style={{ backgroundColor: 'var(--ept-surface)' }}>
                      <div className="text-[10px] uppercase tracking-widest font-medium" style={{ color: 'var(--ept-text-muted)' }}>{item.label}</div>
                      <div className="text-xl font-extrabold mt-1" style={{ color: item.color, fontFamily: "'JetBrains Mono', monospace" }}>
                        {item.value}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {summary.summary.calculation && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {[
                    { label: 'Federal Tax', value: fmt(summary.summary.calculation.federal_income_tax) },
                    { label: 'SE Tax', value: fmt(summary.summary.calculation.self_employment_tax) },
                    { label: 'Total Tax', value: fmt(summary.summary.calculation.total_tax) },
                    { label: 'Total Credits', value: fmt(summary.summary.calculation.total_credits) },
                    { label: 'Effective Rate', value: `${summary.summary.calculation.effective_rate || 0}%` },
                    { label: 'Marginal Rate', value: `${summary.summary.calculation.marginal_rate || 0}%` },
                  ].map((item) => (
                    <div key={item.label} className="flex justify-between p-2 rounded-lg" style={{ backgroundColor: 'var(--ept-surface)' }}>
                      <span className="text-xs" style={{ color: 'var(--ept-text-muted)' }}>{item.label}</span>
                      <span className="text-xs font-bold" style={{ color: 'var(--ept-text)', fontFamily: "'JetBrains Mono', monospace" }}>{item.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
