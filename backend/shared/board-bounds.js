// Grid coordinates name a cell's upper-left corner. Tokens are centred at +0.5.
export function validateBounds(value) {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== 'height,width,x,y' ||
      !Object.values(value).every(n => typeof n === 'number' && Number.isFinite(n)) ||
      Math.abs(value.x)>1000 || Math.abs(value.y)>1000 || value.width<1 || value.width>200 || value.height<1 || value.height>200) throw new Error('INVALID_MESSAGE');
  return {x:value.x,y:value.y,width:value.width,height:value.height};
}
export function insideBounds(point, size = 1, bounds = null) {
  if (!bounds) return true;
  const radius = .34 * size, epsilon = 1e-8;
  return point.x + .5 - radius >= bounds.x - epsilon && point.y + .5 - radius >= bounds.y - epsilon &&
    point.x + .5 + radius <= bounds.x + bounds.width + epsilon && point.y + .5 + radius <= bounds.y + bounds.height + epsilon;
}
export const mapBounds = map => map ? {x:map.xCells,y:map.yCells,width:map.widthCells,height:map.heightCells} : null;
