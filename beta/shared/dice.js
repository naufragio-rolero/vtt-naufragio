export const DIE_SIDES = Object.freeze([4,6,8,10,12,20,100]);
export function parseDice(notation) {
  if (typeof notation !== 'string' || notation.length > 32) throw new Error('INVALID_DICE');
  const match = /^([1-9][0-9]?)d(4|6|8|10|12|20|100)([+-](?:0|[1-9][0-9]{0,3}))?$/.exec(notation);
  if (!match) throw new Error('INVALID_DICE');
  const count = Number(match[1]), sides = Number(match[2]), modifier = Number(match[3] || 0);
  if (count > 50 || Math.abs(modifier) > 1000) throw new Error('INVALID_DICE');
  return {count,sides,modifier};
}
