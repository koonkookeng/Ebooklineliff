// SSOT Phase 103 Task 6 — Support chat widget (virtualized, <28MB RAM)
// Canonical: apps/frontend/components/support/SupportChat.tsx
// - 5-state machine (LIFF_INIT → IDLE → LOADING → SUCCESS/ERROR)
// - Window-20 virtualization + SSE + quick actions. Zero-dep (React).
'use client';

import React, { useRef } from 'react';
import { useSupport } from '../../hooks/useSupport';

function Suggestion({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="px-3 py-1 text-xs bg-slate-800 rounded-full hover:bg-slate-700">{label}</button>;
}

function MessageBubble({ sender, text }: { sender: 'USER' | 'AI' | 'AGENT' | 'SYSTEM'; text: string }) {
  const isUser = sender === 'USER';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-2`}>
      <div
        className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm ${
          isUser ? 'bg-indigo-600 text-white' : sender === 'AI' ? 'bg-slate-800 text-white' : sender === 'AGENT' ? 'bg-emerald-900/50 text-emerald-100' : 'bg-amber-900/50 text-amber-100'
        }`}
      >
        <span className="text-[10px] text-slate-400 block mb-0.5 capitalize">{sender.toLowerCase()}</span>
        <p className="whitespace-pre-wrap">{text}</p>
      </div>
    </div>
  );
}

export function SupportChat() {
  const {
    status,
    tickets,
    activeTicket,
    messages,
    input,
    setInput,
    categories,
    error,
    botTyping,
    openTicket,
    newTicket,
    send,
    retry,
  } = useSupport();
  const endRef = useRef<HTMLDivElement>(null);

  if (status === 'LIFF_INIT') {
    return <div className="flex items-center justify-center h-full"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" /></div>;
  }

  if (status === 'ERROR' && !activeTicket) {
    return (
      <div className="p-4 text-center">
        <p className="text-red-400">{error ?? 'Failed to load support'}</p>
        <button onClick={retry} className="mt-2 px-4 py-2 bg-indigo-600 rounded-lg text-sm">ลองใหม่</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-950 text-white">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold">สนับสนุน</span>
          <span className="px-2 py-0.5 text-xs bg-indigo-600 rounded-full">AI Assistant</span>
        </div>
        <button onClick={newTicket} className="px-3 py-1 text-xs bg-slate-800 rounded-lg hover:bg-slate-700">
          ตั๋วใหม่
        </button>
      </div>

      {/* Ticket List (when no active ticket) */}
      {!activeTicket && (
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {categories.map((cat) => (
            <div key={cat.id} className="bg-slate-800/50 p-3 rounded-lg">
              <p className="font-medium">{cat.name}</p>
              <p className="text-xs text-slate-400">เลือกเพื่อสร้างตั๋วใหม่</p>
            </div>
          ))}
          {tickets.length > 0 && (
            <>
              <p className="px-3 py-1 text-xs text-slate-400">ตั๋วของฉัน</p>
              {tickets.map((t) => (
                <button
                  key={t.id}
                  onClick={() => openTicket(t.id)}
                  className="w-full text-left bg-slate-800/50 p-3 rounded-lg hover:bg-slate-800 flex items-center justify-between"
                >
                  <div>
                    <p className="font-medium">{t.subject}</p>
                    <p className="text-xs text-slate-400">{t.ticketNo} · {t.status}</p>
                  </div>
                  <span className={`px-2 py-0.5 text-xs rounded-full ${
                    t.priority === 'URGENT' ? 'bg-red-500/20 text-red-400' :
                    t.priority === 'HIGH' ? 'bg-orange-500/20 text-orange-400' :
                    t.priority === 'MEDIUM' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-green-500/20 text-green-400'
                  }`}>
                    {t.priority}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {/* Active Ticket Chat */}
      {activeTicket && (
        <div className="flex flex-col flex-1">
          <div className="p-3 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
            <div>
              <p className="font-medium truncate">{activeTicket.subject}</p>
              <p className="text-xs text-slate-400">{activeTicket.ticketNo} · {activeTicket.status}</p>
            </div>
            <span className={`px-2 py-0.5 text-xs rounded-full ${
              activeTicket.priority === 'URGENT' ? 'bg-red-500/20 text-red-400' :
              activeTicket.priority === 'HIGH' ? 'bg-orange-500/20 text-orange-400' :
              activeTicket.priority === 'MEDIUM' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-green-500/20 text-green-400'
            }`}>
              {activeTicket.priority}
            </span>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3" ref={endRef}>
            {messages.map((m, i) => (
              <MessageBubble key={i} sender={m.sender} text={m.text} />
            ))}
            {botTyping && (
              <div className="flex items-center gap-2 text-slate-400 text-sm">
                <span className="animate-bounce">⋯</span>
                <span>AI กำลังพิมพ์...</span>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* Quick Suggestions (when no active typing) */}
          {!botTyping && (
            <div className="p-2 border-t border-slate-800">
              <p className="text-xs text-slate-400 mb-1">คำแนะนำ:</p>
              <div className="flex flex-wrap gap-1">
                <Suggestion label="เช็กสถานะออร์เดอร์" onClick={() => void send('เช็กสถานะออร์เดอร์ของฉัน')} />
                <Suggestion label="ปัญหา E-Book" onClick={() => void send('อ่าน E-Book หน้า 15 ไม่ได้')} />
                <Suggestion label="ปัญหาการชำระเงิน" onClick={() => void send('ชำระเงินแล้วแต่ไม่ได้เข้าคอร์ส')} />
                <Suggestion label="คุยกับเจ้าหน้าที่" onClick={() => void send('ขอคุยกับเจ้าหน้าที่')} />
              </div>
            </div>
          )}

          {/* Input */}
          <div className="p-3 border-t border-slate-800 bg-slate-950">
            <form onSubmit={(e) => { e.preventDefault(); void send(input); }}>
              <div className="flex gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={activeTicket ? 'พิมพ์ข้อความ...' : 'เลือกตั๋วหรือสร้างใหม่เพื่อเริ่มแชท'}
                  maxLength={1000}
                  className="flex-1 bg-slate-800 text-white text-sm rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  disabled={botTyping}
                />
                <button
                  type="submit"
                  disabled={!input.trim() || botTyping}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  ส่ง
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default SupportChat;