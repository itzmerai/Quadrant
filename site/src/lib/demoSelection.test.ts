import { describe, expect, it } from 'vitest';

/**
 * The demo's selection maths, extracted so it can be checked without a browser.
 * Mirrors the boxFrom/inside logic in LiveDemo's script.
 */
const boxFrom = (a: {x:number;y:number}, b: {x:number;y:number}) => ({
  left: Math.min(a.x, b.x),
  top: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x),
  height: Math.abs(a.y - b.y),
});

type B = ReturnType<typeof boxFrom>;
const inside = (p: {x:number;y:number}, b: B) =>
  p.x >= b.left && p.x <= b.left + b.width && p.y >= b.top && p.y <= b.top + b.height;

describe('demo selection', () => {
  it('normalises a drag made up-and-left', () => {
    expect(boxFrom({x:70,y:80},{x:30,y:20})).toEqual({left:30,top:20,width:40,height:60});
  });
  it('normalises a drag made down-and-right', () => {
    expect(boxFrom({x:30,y:20},{x:70,y:80})).toEqual({left:30,top:20,width:40,height:60});
  });
  it('selects a point inside the box', () => {
    expect(inside({x:50,y:50}, boxFrom({x:30,y:20},{x:70,y:80}))).toBe(true);
  });
  it('excludes a point outside the box', () => {
    expect(inside({x:10,y:50}, boxFrom({x:30,y:20},{x:70,y:80}))).toBe(false);
  });
  it('includes a point exactly on the edge', () => {
    expect(inside({x:30,y:20}, boxFrom({x:30,y:20},{x:70,y:80}))).toBe(true);
  });
  it('treats a zero-area click as selecting only that exact point', () => {
    const b = boxFrom({x:40,y:40},{x:40,y:40});
    expect(b.width).toBe(0);
    expect(inside({x:40,y:40}, b)).toBe(true);
    expect(inside({x:41,y:40}, b)).toBe(false);
  });
});
