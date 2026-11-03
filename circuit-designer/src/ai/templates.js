// Built-in reference designs. Used when no ANTHROPIC_API_KEY is configured
// (offline/demo mode) and as worked examples for the AI.

const T = [];

T.push({
  keywords: ['555', 'blink', 'flash', 'astable', 'timer', 'oscillator'],
  design: {
    title: '555 LED flasher',
    summary: 'NE555 in astable mode flashing an LED at about 1.4 Hz from a 5-12 V supply.',
    components: [
      { ref: 'J1', part: 'CONN_1x02', value: 'PWR 5-12V', footprint: 'TerminalBlock_1x02_P5.08mm', purpose: 'Power input (1=+V, 2=GND)' },
      { ref: 'U1', part: 'NE555', value: 'NE555', footprint: 'DIP-8_W7.62mm', purpose: 'Astable timer' },
      { ref: 'R1', part: 'R', value: '1k', footprint: 'R_0805', purpose: 'Timing RA' },
      { ref: 'R2', part: 'R', value: '47k', footprint: 'R_0805', purpose: 'Timing RB' },
      { ref: 'C1', part: 'C_POL', value: '10uF', footprint: 'CP_Radial_D5.0mm_P2.00mm', purpose: 'Timing capacitor, f = 1.44/((RA+2RB)C)' },
      { ref: 'C2', part: 'C', value: '10nF', footprint: 'C_0805', purpose: 'CTRL pin decoupling' },
      { ref: 'C3', part: 'C', value: '100nF', footprint: 'C_0805', purpose: 'Supply decoupling' },
      { ref: 'R3', part: 'R', value: '470', footprint: 'R_0805', purpose: 'LED current limit' },
      { ref: 'D1', part: 'LED', value: 'Red', footprint: 'LED_D5.0mm', purpose: 'Indicator LED' },
    ],
    nets: [
      { name: 'VCC', pins: ['J1.1', 'U1.8', 'U1.4', 'R1.1', 'C3.1'] },
      { name: 'GND', pins: ['J1.2', 'U1.1', 'C1.2', 'C2.2', 'C3.2', 'D1.1'] },
      { name: 'DIS', pins: ['R1.2', 'R2.1', 'U1.7'] },
      { name: 'THR', pins: ['R2.2', 'U1.6', 'U1.2', 'C1.1'] },
      { name: 'CTRL', pins: ['U1.5', 'C2.1'] },
      { name: 'OUT', pins: ['U1.3', 'R3.1'] },
      { name: 'LED_A', pins: ['R3.2', 'D1.2'] },
    ],
    no_connect: [],
    notes: ['Change R2 or C1 to adjust the flash rate.', 'LED current is about (VCC-2V)/470 ohm.'],
  },
});

T.push({
  keywords: ['regulator', 'ldo', '3.3', '3v3', 'power supply', 'usb-c', 'usb c', 'ams1117'],
  design: {
    title: 'USB-C to 3.3 V power board',
    summary: 'USB-C sink (5.1k CC pull-downs) feeding an AMS1117-3.3 LDO with power LED and output header.',
    components: [
      { ref: 'J1', part: 'USB_C_POWER', value: 'USB-C', footprint: 'USB_C_Receptacle_16P', purpose: '5 V input' },
      { ref: 'R1', part: 'R', value: '5.1k', footprint: 'R_0603', purpose: 'CC1 pull-down (sink)' },
      { ref: 'R2', part: 'R', value: '5.1k', footprint: 'R_0603', purpose: 'CC2 pull-down (sink)' },
      { ref: 'C1', part: 'C', value: '10uF', footprint: 'C_0805', purpose: 'LDO input capacitor' },
      { ref: 'U1', part: 'AMS1117-3.3', value: 'AMS1117-3.3', footprint: 'SOT-223-3_TabPin2', purpose: '3.3 V regulator' },
      { ref: 'C2', part: 'C', value: '22uF', footprint: 'C_1206', purpose: 'LDO output capacitor' },
      { ref: 'C3', part: 'C', value: '100nF', footprint: 'C_0603', purpose: 'Output HF decoupling' },
      { ref: 'R3', part: 'R', value: '1k', footprint: 'R_0603', purpose: 'Power LED resistor' },
      { ref: 'D1', part: 'LED', value: 'Green', footprint: 'LED_0805', purpose: 'Power LED' },
      { ref: 'J2', part: 'CONN_1x03', value: 'OUT', footprint: 'PinHeader_1x03_P2.54mm_Vertical', purpose: '1=+3V3 2=GND 3=VBUS' },
    ],
    nets: [
      { name: 'VBUS', pins: ['J1.A4', 'J1.A9', 'J1.B4', 'J1.B9', 'C1.1', 'U1.3', 'J2.3'] },
      { name: 'GND', pins: ['J1.A1', 'J1.A12', 'J1.B1', 'J1.B12', 'J1.S1', 'R1.2', 'R2.2', 'C1.2', 'U1.1', 'C2.2', 'C3.2', 'D1.1', 'J2.2'] },
      { name: 'CC1', pins: ['J1.A5', 'R1.1'] },
      { name: 'CC2', pins: ['J1.B5', 'R2.1'] },
      { name: '+3V3', pins: ['U1.2', 'U1.4', 'C2.1', 'C3.1', 'R3.1', 'J2.1'] },
      { name: 'LED_A', pins: ['R3.2', 'D1.2'] },
    ],
    no_connect: ['J1.A6', 'J1.B6', 'J1.A7', 'J1.B7', 'J1.A8', 'J1.B8'],
    notes: ['AMS1117 dropout is ~1.1 V; fine from 5 V USB.', 'Max output ~800 mA, mind the LDO dissipation.'],
  },
});

T.push({
  keywords: ['esp32', 'wifi', 'wi-fi', 'bluetooth', 'iot', 'wireless', 'ch340', 'microcontroller', 'gpio'],
  design: {
    title: 'ESP32 dev board (USB-C, CH340C, auto-reset)',
    summary: 'ESP32-WROOM-32 with USB-C, CH340C USB-UART, two-transistor auto-program circuit, AMS1117 3.3 V LDO, BOOT/RESET buttons, LED on IO2 and a GPIO header.',
    components: [
      { ref: 'J1', part: 'USB_C_POWER', value: 'USB-C', footprint: 'USB_C_Receptacle_16P', purpose: 'Power + USB data' },
      { ref: 'R1', part: 'R', value: '5.1k', footprint: 'R_0603', purpose: 'CC1 pull-down' },
      { ref: 'R2', part: 'R', value: '5.1k', footprint: 'R_0603', purpose: 'CC2 pull-down' },
      { ref: 'C1', part: 'C', value: '10uF', footprint: 'C_0805', purpose: 'VBUS bulk' },
      { ref: 'U1', part: 'AMS1117-3.3', value: 'AMS1117-3.3', footprint: 'SOT-223-3_TabPin2', purpose: '3.3 V LDO' },
      { ref: 'C2', part: 'C', value: '22uF', footprint: 'C_1206', purpose: '3V3 bulk' },
      { ref: 'C3', part: 'C', value: '100nF', footprint: 'C_0603', purpose: 'ESP32 decoupling' },
      { ref: 'U2', part: 'CH340C', value: 'CH340C', footprint: 'SOIC-16_3.9x10.3mm_P1.27mm', purpose: 'USB-UART bridge' },
      { ref: 'C4', part: 'C', value: '100nF', footprint: 'C_0603', purpose: 'CH340C decoupling' },
      { ref: 'U3', part: 'ESP32-WROOM-32', value: 'ESP32-WROOM-32', footprint: 'ESP32-WROOM-32', purpose: 'MCU module' },
      { ref: 'R3', part: 'R', value: '10k', footprint: 'R_0603', purpose: 'EN pull-up' },
      { ref: 'C5', part: 'C', value: '1uF', footprint: 'C_0603', purpose: 'EN RC delay' },
      { ref: 'R4', part: 'R', value: '10k', footprint: 'R_0603', purpose: 'IO0 pull-up' },
      { ref: 'SW1', part: 'SW_PUSH', value: 'BOOT', footprint: 'SW_SPST_SMD_5.2x5.2mm', purpose: 'Boot button (IO0)' },
      { ref: 'SW2', part: 'SW_PUSH', value: 'RESET', footprint: 'SW_SPST_SMD_5.2x5.2mm', purpose: 'Reset button (EN)' },
      { ref: 'Q1', part: 'MMBT3904', value: 'MMBT3904', footprint: 'SOT-23', purpose: 'Auto-reset EN' },
      { ref: 'Q2', part: 'MMBT3904', value: 'MMBT3904', footprint: 'SOT-23', purpose: 'Auto-reset IO0' },
      { ref: 'R5', part: 'R', value: '10k', footprint: 'R_0603', purpose: 'Q1 base' },
      { ref: 'R6', part: 'R', value: '10k', footprint: 'R_0603', purpose: 'Q2 base' },
      { ref: 'R7', part: 'R', value: '1k', footprint: 'R_0603', purpose: 'LED resistor' },
      { ref: 'D1', part: 'LED', value: 'Blue', footprint: 'LED_0603', purpose: 'User LED on IO2' },
      { ref: 'J2', part: 'CONN_1x08', value: 'GPIO', footprint: 'PinHeader_1x08_P2.54mm_Vertical', purpose: '3V3, GND, IO4, IO5, IO18, IO19, IO21, IO22' },
    ],
    nets: [
      { name: 'VBUS', pins: ['J1.A4', 'J1.A9', 'J1.B4', 'J1.B9', 'C1.1', 'U1.3'] },
      { name: 'GND', pins: ['J1.A1', 'J1.A12', 'J1.B1', 'J1.B12', 'J1.S1', 'R1.2', 'R2.2', 'C1.2', 'U1.1', 'C2.2', 'C3.2', 'U2.1', 'C4.2', 'U3.1', 'U3.15', 'U3.38', 'U3.39', 'C5.2', 'SW1.2', 'SW2.2', 'D1.1', 'J2.2'] },
      { name: '+3V3', pins: ['U1.2', 'U1.4', 'C2.1', 'C3.1', 'U2.16', 'U2.4', 'C4.1', 'U3.2', 'R3.1', 'R4.1', 'J2.1'] },
      { name: 'CC1', pins: ['J1.A5', 'R1.1'] },
      { name: 'CC2', pins: ['J1.B5', 'R2.1'] },
      { name: 'USB_DP', pins: ['J1.A6', 'J1.B6', 'U2.5'] },
      { name: 'USB_DM', pins: ['J1.A7', 'J1.B7', 'U2.6'] },
      { name: 'EN', pins: ['U3.3', 'R3.2', 'C5.1', 'SW2.1', 'Q1.3'] },
      { name: 'IO0', pins: ['U3.25', 'R4.2', 'SW1.1', 'Q2.3'] },
      { name: 'DTR', pins: ['U2.13', 'R5.1', 'Q2.2'] },
      { name: 'RTS', pins: ['U2.14', 'R6.1', 'Q1.2'] },
      { name: 'Q1_B', pins: ['R5.2', 'Q1.1'] },
      { name: 'Q2_B', pins: ['R6.2', 'Q2.1'] },
      { name: 'ESP_RX', pins: ['U2.2', 'U3.34'] },
      { name: 'ESP_TX', pins: ['U2.3', 'U3.35'] },
      { name: 'IO2_LED', pins: ['U3.24', 'R7.1'] },
      { name: 'LED_A', pins: ['R7.2', 'D1.2'] },
      { name: 'IO4', pins: ['U3.26', 'J2.3'] },
      { name: 'IO5', pins: ['U3.29', 'J2.4'] },
      { name: 'IO18', pins: ['U3.30', 'J2.5'] },
      { name: 'IO19', pins: ['U3.31', 'J2.6'] },
      { name: 'IO21', pins: ['U3.33', 'J2.7'] },
      { name: 'IO22', pins: ['U3.36', 'J2.8'] },
    ],
    no_connect: ['J1.A8', 'J1.B8', 'U2.15', 'U2.9', 'U2.10', 'U2.11', 'U2.12',
      'U3.4', 'U3.5', 'U3.6', 'U3.7', 'U3.8', 'U3.9', 'U3.10', 'U3.11', 'U3.12', 'U3.13', 'U3.14', 'U3.16', 'U3.23', 'U3.27', 'U3.28', 'U3.37'],
    notes: ['Keep copper out from under the module antenna (top 6.75 mm).', 'CH340C runs from 3.3 V with V3 tied to VCC.'],
  },
});

T.push({
  keywords: ['relay', 'switch load', 'mains', 'ac load'],
  design: {
    title: '5 V relay driver',
    summary: 'Logic-level input drives an SPDT relay through an NPN transistor with flyback diode and status LED.',
    components: [
      { ref: 'J1', part: 'CONN_1x03', value: 'CTRL', footprint: 'PinHeader_1x03_P2.54mm_Vertical', purpose: '1=+5V 2=IN 3=GND' },
      { ref: 'R1', part: 'R', value: '1k', footprint: 'R_0805', purpose: 'Base resistor' },
      { ref: 'R2', part: 'R', value: '10k', footprint: 'R_0805', purpose: 'Base pull-down' },
      { ref: 'Q1', part: 'MMBT3904', value: 'MMBT3904', footprint: 'SOT-23', purpose: 'Coil driver' },
      { ref: 'D1', part: 'D', value: '1N4148', footprint: 'D_SOD-123', purpose: 'Flyback diode' },
      { ref: 'K1', part: 'RELAY_SPDT', value: 'SRD-05VDC-SL-C', footprint: 'Relay_SRD-05VDC', purpose: 'Relay' },
      { ref: 'R3', part: 'R', value: '1k', footprint: 'R_0805', purpose: 'LED resistor' },
      { ref: 'D2', part: 'LED', value: 'Red', footprint: 'LED_0805', purpose: 'Relay ON indicator' },
      { ref: 'J2', part: 'CONN_1x03', value: 'LOAD', footprint: 'TerminalBlock_1x03_P5.08mm', purpose: '1=COM 2=NO 3=NC' },
      { ref: 'C1', part: 'C', value: '10uF', footprint: 'C_0805', purpose: 'Supply bulk' },
    ],
    nets: [
      { name: '+5V', pins: ['J1.1', 'K1.2', 'D1.1', 'R3.1', 'C1.1'] },
      { name: 'GND', pins: ['J1.3', 'R2.2', 'Q1.2', 'C1.2'] },
      { name: 'IN', pins: ['J1.2', 'R1.1'] },
      { name: 'BASE', pins: ['R1.2', 'R2.1', 'Q1.1'] },
      { name: 'COIL_LOW', pins: ['Q1.3', 'K1.5', 'D1.2', 'D2.1'] },
      { name: 'LED_A', pins: ['R3.2', 'D2.2'] },
      { name: 'COM', pins: ['K1.1', 'J2.1'] },
      { name: 'NO', pins: ['K1.4', 'J2.2'] },
      { name: 'NC', pins: ['K1.3', 'J2.3'] },
    ],
    no_connect: [],
    notes: ['For mains loads keep >= 3 mm creepage between the contact side and the low-voltage side, and add a slot if needed.'],
  },
});

export const TEMPLATES = T;

export function pickTemplate(prompt) {
  const p = prompt.toLowerCase();
  let best = null, bestScore = 0;
  for (const t of T) {
    const s = t.keywords.reduce((a, k) => a + (p.includes(k) ? 1 : 0), 0);
    if (s > bestScore) { best = t; bestScore = s; }
  }
  return best;
}
