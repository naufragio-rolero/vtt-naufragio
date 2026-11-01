import { randomInt, randomUUID } from 'node:crypto';
import { HttpError } from '../errors.js';
import { createLimiter } from '../limits.js';
import { requirePermission } from '../auth/permissions.js';
import { exact, uuid } from '../../shared/token-state.js';
import { parseDice } from '../../shared/dice.js';

export function createDiceService({store,rooms,namespace,game,clock=Date.now}) {
  const db=store.db, accept=createLimiter(6,10000,{clock});
  const fail=code=>{throw new HttpError(400,code);};
  function list(roomId) {
    return db.prepare('SELECT result_json FROM dice_rolls WHERE room_id=? ORDER BY rowid DESC LIMIT 50').all(roomId).map(row=>JSON.parse(row.result_json));
  }
  function prune(roomId) {
    // Keep at most 50 old results, plus a bounded replay window for fresh requests.
    db.prepare(`DELETE FROM dice_rolls WHERE room_id=? AND created_at<? AND rowid NOT IN
      (SELECT rowid FROM dice_rolls WHERE room_id=? ORDER BY rowid DESC LIMIT 50)`).run(roomId,clock()-120000,roomId);
  }
  return {
    handles:event=>['dice:roll','dice:history:get'].includes(event),
    connected(socket) { socket.emit('dice:history',{version:1,roomId:socket.data.roomId,rolls:list(socket.data.roomId)}); },
    handle(socket,event,input) {
      const access=rooms.access(socket.data.token,socket.data.roomId), roomId=access.room.id;
      try { exact(input,['version','roomId',...(event==='dice:roll'?['eventId','issuedAt','notation']:[])]); }
      catch { fail('INVALID_MESSAGE'); }
      if (input.version!==1 || input.roomId!==roomId) fail('INVALID_MESSAGE');
      if (event==='dice:history:get') return {rolls:list(roomId)};
      requirePermission(access.actor,'dice:roll',{member:true,ownerId:access.room.ownerId,directorOnline:game.isReady(roomId),diceAllowed:access.permissions.diceAllowed});
      if (!uuid(input.eventId) || !Number.isSafeInteger(input.issuedAt) || Math.abs(clock()-input.issuedAt)>60000) fail('STALE_ROLL');
      let dice; try { dice=parseDice(input.notation); } catch { fail('INVALID_DICE'); }
      if (db.prepare('SELECT 1 FROM dice_rolls WHERE room_id=? AND request_id=?').get(roomId,input.eventId)) fail('ROLL_REPLAYED');
      if (!accept(roomId+'|'+access.actor.id)) throw new HttpError(429,'DICE_RATE_LIMITED');
      prune(roomId);
      if (db.prepare('SELECT count(*) AS n FROM dice_rolls WHERE room_id=?').get(roomId).n>=256) throw new HttpError(429,'ROLL_CAPACITY');
      const results=Array.from({length:dice.count},()=>randomInt(1,dice.sides+1));
      const roll={id:randomUUID(),author:{id:access.actor.id,name:access.actor.username},notation:input.notation,...dice,results,
        total:results.reduce((a,b)=>a+b,0)+dice.modifier,time:clock(),verified:true};
      db.prepare('INSERT INTO dice_rolls VALUES (?,?,?,?)').run(roomId,input.eventId,roll.time,JSON.stringify(roll));
      for (const peer of namespace.sockets.values()) {
        if (!peer.connected || peer.data.roomId!==roomId) continue;
        try { rooms.access(peer.data.token,roomId); peer.emit('dice:result',{version:1,roomId,roll}); }
        catch { peer.disconnect(true); }
      }
      return {roll};
    }
  };
}
