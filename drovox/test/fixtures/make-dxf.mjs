// Builds a small ASCII DXF: 100 × 50 mm plate (4 loose lines, out of order), Ø10 hole, rounded slot.
export function plateDxf() {
  const L = (x1, y1, x2, y2) => `0\nLINE\n8\n0\n10\n${x1}\n20\n${y1}\n11\n${x2}\n21\n${y2}\n`;
  const C = (x, y, r) => `0\nCIRCLE\n8\n0\n10\n${x}\n20\n${y}\n40\n${r}\n`;
  // slot 30 × 10 with semicircle ends: (60,20)→(80,20) arc to (80,30) → (60,30) arc back
  const slot = '0\nLWPOLYLINE\n8\n0\n90\n4\n70\n1\n10\n60\n20\n20\n42\n0\n10\n80\n20\n20\n42\n1\n10\n80\n20\n30\n42\n0\n10\n60\n20\n30\n42\n1\n';
  return `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${L(0, 0, 100, 0)}${L(0, 50, 100, 50)}${L(100, 50, 100, 0)}${L(0, 0, 0, 50)}${C(20, 25, 5)}${slot}0\nTEXT\n8\n0\n10\n5\n20\n5\n40\n3\n1\nDROVOX\n0\nENDSEC\n0\nEOF\n`;
}
