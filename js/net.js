'use strict';
// Peer-to-peer transport (WebRTC via PeerJS). The host runs the simulation; clients send inputs and render snapshots.
// Works on static hosting (Vercel): signalling goes through the public PeerJS cloud broker.
const Net = {
  peer: null, role: 'solo', code: '', conns: new Map(), loaded: null,
  load() {
    if (this.loaded) return this.loaded;
    const urls = ['https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js', 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js'];
    this.loaded = new Promise((res, rej) => {
      if (window.Peer) return res();
      let i = 0; const next = () => {
        if (i >= urls.length) return rej(new Error('PeerJS yüklenemedi (internet bağlantısı?)'));
        const sc = document.createElement('script'); sc.src = urls[i++]; sc.onload = () => res(); sc.onerror = () => { sc.remove(); next(); }; document.head.appendChild(sc);
      }; next();
    });
    this.loaded.catch(() => { this.loaded = null; });
    return this.loaded;
  },
  randCode() { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 5; i++) s += a[(Math.random() * a.length) | 0]; return s; },
  open(id) {
    return new Promise((res, rej) => {
      const peer = new Peer(id, { debug: 1 }); let done = false;
      peer.on('open', () => { done = true; res(peer); });
      peer.on('error', e => { if (!done) rej(e); else if (this.onError) this.onError(e); });
      setTimeout(() => { if (!done) rej(new Error('Bağlantı sunucusuna ulaşılamadı')); }, 12000);
    });
  },
  // ---- host ----
  async host(handlers) {
    await this.load(); this.role = 'host'; this.h = handlers;
    for (let tries = 0; tries < 5; tries++) {
      const code = this.randCode();
      try { this.peer = await this.open('gemisavas-' + code); this.code = code; break; } catch (e) { if (e.type !== 'unavailable-id' || tries === 4) throw e; }
    }
    this.peer.on('connection', conn => {
      conn.on('open', () => { this.conns.set(conn.peer, conn); handlers.join(conn.peer, conn); });
      conn.on('data', d => handlers.msg(conn.peer, d));
      conn.on('close', () => { if (this.conns.delete(conn.peer)) handlers.leave(conn.peer); });
      conn.on('error', () => { if (this.conns.delete(conn.peer)) handlers.leave(conn.peer); });
    });
    return this.code;
  },
  // ---- client ----
  async join(code, handlers) {
    await this.load(); this.role = 'client'; this.code = code.trim().toUpperCase();
    this.peer = await this.open(undefined);
    return new Promise((res, rej) => {
      const conn = this.peer.connect('gemisavas-' + this.code, { reliable: true, serialization: 'json' }); let ok = false;
      conn.on('open', () => { ok = true; this.host_ = conn; res(conn); });
      conn.on('data', d => handlers.msg(d));
      conn.on('close', () => handlers.close());
      conn.on('error', e => { if (!ok) rej(e); else handlers.close(); });
      this.peer.on('error', e => { if (!ok) rej(e); });
      setTimeout(() => { if (!ok) rej(new Error('Odaya bağlanılamadı: kod yanlış ya da host çevrimdışı')); }, 12000);
    });
  },
  send(conn, m) { try { if (conn && conn.open) conn.send(m); } catch (e) { /* peer gone */ } },
  toHost(m) { this.send(this.host_, m); },
  broadcast(m) { for (const c of this.conns.values()) this.send(c, m); },
  close() { try { this.peer && this.peer.destroy(); } catch (e) { /* ignore */ } this.peer = null; this.conns.clear(); this.role = 'solo'; this.host_ = null; },
};
