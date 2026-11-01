// Loyalty points, referral rewards and daily check-in streaks.
import { get, run, getSetting } from '../db.js';

export function addPoints(userId, change, reason, ref) {
  if (!change) return;
  run('INSERT INTO points_ledger(user_id, change, reason, ref) VALUES (?,?,?,?)', userId, change, reason, ref ?? null);
  run('UPDATE users SET points = MAX(0, points + ?) WHERE id = ?', change, userId);
}

/** Called once the user's order is delivered: credits order points and, on the first order, the referrer bonus. */
export function onOrderDelivered(order) {
  if (!order.user_id) return [];
  const out = [];
  const already = get(`SELECT 1 FROM points_ledger WHERE user_id = ? AND reason = 'order' AND ref = ?`, order.user_id, order.order_no);
  if (!already && order.points_earned > 0) { addPoints(order.user_id, order.points_earned, 'order', order.order_no); out.push({ user_id: order.user_id, points: order.points_earned }); }
  const ref = get(`SELECT * FROM referrals WHERE referee_id = ? AND status = 'pending'`, order.user_id);
  if (ref) {
    const L = getSetting('loyalty');
    addPoints(ref.referrer_id, L.referrer_bonus, 'referral', `user:${order.user_id}`);
    run(`UPDATE referrals SET status = 'rewarded', reward_points = ?, rewarded_at = datetime('now') WHERE id = ?`, L.referrer_bonus, ref.id);
    out.push({ user_id: ref.referrer_id, points: L.referrer_bonus, referral: true });
  }
  return out;
}

/** Daily check-in: small reward for coming back each day, with a bonus every 7-day streak. */
export function dailyCheckin(user) {
  const L = getSetting('loyalty');
  const today = new Date().toISOString().slice(0, 10);
  if (user.last_checkin === today) return { already: true, streak: user.checkin_streak, points: 0 };
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const streak = user.last_checkin === yesterday ? user.checkin_streak + 1 : 1;
  let pts = L.daily_checkin;
  if (streak % 7 === 0) pts += L.streak_bonus_7;
  run('UPDATE users SET last_checkin = ?, checkin_streak = ? WHERE id = ?', today, streak, user.id);
  addPoints(user.id, pts, 'checkin', today);
  return { already: false, streak, points: pts };
}
