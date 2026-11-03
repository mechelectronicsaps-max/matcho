// Component library: schematic symbol kind, pinout and the footprints each
// part may use. Pin numbers must match the pad numbers of every footprint
// listed for the part.
//
// symbol kinds: resistor, capacitor, capacitor_pol, inductor, diode, zener,
// schottky, led, fuse, crystal, pot, switch, buzzer, npn, pnp, nmos, pmos,
// ic (box with pins on left/right), connector (box, pins on one side).

const CHIP = (prefix, sizes = ['0402', '0603', '0805', '1206']) => sizes.map((s) => `${prefix}_${s}`);
const p = (num, name, side, type = 'io') => ({ num: String(num), name, side, type });

const parts = [];
const add = (c) => parts.push({ valueDefault: '', ...c });

// ---------------------------------------------------------------- passives
add({ id: 'R', name: 'Resistor', category: 'Passive', refPrefix: 'R', symbol: 'resistor', valueDefault: '10k',
  description: 'Resistor (set value e.g. 220, 4.7k, 1M)', pins: [p(1, '~'), p(2, '~')],
  footprints: [...CHIP('R', ['0402', '0603', '0805', '1206', '2512']), 'R_Axial_P7.62mm_Horizontal', 'R_Axial_P10.16mm_Horizontal'] });
add({ id: 'C', name: 'Capacitor (non-polarised)', category: 'Passive', refPrefix: 'C', symbol: 'capacitor', valueDefault: '100nF',
  description: 'Ceramic / film capacitor', pins: [p(1, '~'), p(2, '~')],
  footprints: [...CHIP('C', ['0402', '0603', '0805', '1206', '1210']), 'C_Disc_P2.50mm', 'C_Disc_P5.00mm'] });
add({ id: 'C_POL', name: 'Capacitor (polarised)', category: 'Passive', refPrefix: 'C', symbol: 'capacitor_pol', valueDefault: '100uF',
  description: 'Electrolytic / tantalum capacitor, pin 1 = +', pins: [p(1, '+'), p(2, '-')],
  footprints: ['CP_Radial_D5.0mm_P2.00mm', 'CP_Radial_D6.3mm_P2.50mm', 'CP_Radial_D8.0mm_P3.50mm', 'CP_Radial_D10.0mm_P5.00mm', 'CP_Elec_5x5', 'CP_Elec_6x6', 'CP_Elec_8x8', 'C_1206', 'C_1210'] });
add({ id: 'L', name: 'Inductor', category: 'Passive', refPrefix: 'L', symbol: 'inductor', valueDefault: '10uH',
  description: 'Inductor / ferrite bead', pins: [p(1, '~'), p(2, '~')],
  footprints: [...CHIP('L', ['0603', '0805', '1206']), 'L_Power_4x4mm', 'L_Power_5x5mm', 'L_Power_6x6mm', 'L_Power_8x8mm', 'L_Power_10x10mm', 'L_Power_12x12mm'] });
add({ id: 'FUSE', name: 'Fuse', category: 'Passive', refPrefix: 'F', symbol: 'fuse', valueDefault: '500mA',
  description: 'Fuse / PTC resettable fuse', pins: [p(1, '~'), p(2, '~')], footprints: ['Fuse_1206', 'Fuse_0805', 'Fuse_1812', 'Fuse_Holder_5x20mm'] });
add({ id: 'POT', name: 'Potentiometer', category: 'Passive', refPrefix: 'RV', symbol: 'pot', valueDefault: '10k',
  description: 'Potentiometer / trimmer, pin 2 = wiper', pins: [p(1, '1'), p(2, 'W'), p(3, '3')], footprints: ['Potentiometer_Bourns_3386P', 'Potentiometer_RV09_Vertical'] });
add({ id: 'CRYSTAL', name: 'Crystal', category: 'Passive', refPrefix: 'Y', symbol: 'crystal', valueDefault: '16MHz',
  description: '2-terminal quartz crystal (add load caps to GND)', pins: [p(1, '1'), p(2, '2')], footprints: ['Crystal_HC49-US', 'Crystal_SMD_5032-2Pin'] });

// ---------------------------------------------------------------- diodes
add({ id: 'D', name: 'Diode', category: 'Diode', refPrefix: 'D', symbol: 'diode', valueDefault: '1N4148',
  description: 'Rectifier / signal diode, pin 1 = K (cathode)', pins: [p(1, 'K'), p(2, 'A')],
  footprints: ['D_SOD-123', 'D_SOD-323', 'D_SMA', 'D_SMB', 'D_DO-41_P10.16mm_Horizontal', 'D_DO-35_P7.62mm_Horizontal', 'D_0805'] });
add({ id: 'D_SCHOTTKY', name: 'Schottky diode', category: 'Diode', refPrefix: 'D', symbol: 'schottky', valueDefault: 'SS34',
  description: 'Schottky diode (e.g. SS34, 1N5819, BAT54), pin 1 = K', pins: [p(1, 'K'), p(2, 'A')],
  footprints: ['D_SMA', 'D_SMB', 'D_SOD-123', 'D_DO-41_P10.16mm_Horizontal'] });
add({ id: 'D_ZENER', name: 'Zener diode', category: 'Diode', refPrefix: 'D', symbol: 'zener', valueDefault: '5V1',
  description: 'Zener / TVS diode, pin 1 = K', pins: [p(1, 'K'), p(2, 'A')], footprints: ['D_SOD-123', 'D_SOD-323', 'D_SMA', 'D_DO-35_P7.62mm_Horizontal'] });
add({ id: 'LED', name: 'LED', category: 'Diode', refPrefix: 'D', symbol: 'led', valueDefault: 'Red',
  description: 'Light emitting diode, pin 1 = K (cathode). Needs a series resistor.', pins: [p(1, 'K'), p(2, 'A')],
  footprints: ['LED_0603', 'LED_0805', 'LED_1206', 'LED_D3.0mm', 'LED_D5.0mm'] });

// ---------------------------------------------------------------- transistors
add({ id: 'MMBT3904', name: 'MMBT3904 NPN', category: 'Transistor', refPrefix: 'Q', symbol: 'npn', valueDefault: 'MMBT3904',
  description: 'NPN 40 V 200 mA, SOT-23 (1=B 2=E 3=C)', pins: [p(1, 'B'), p(2, 'E'), p(3, 'C')], footprints: ['SOT-23'] });
add({ id: 'MMBT3906', name: 'MMBT3906 PNP', category: 'Transistor', refPrefix: 'Q', symbol: 'pnp', valueDefault: 'MMBT3906',
  description: 'PNP 40 V 200 mA, SOT-23 (1=B 2=E 3=C)', pins: [p(1, 'B'), p(2, 'E'), p(3, 'C')], footprints: ['SOT-23'] });
add({ id: 'BC547', name: 'BC547 NPN', category: 'Transistor', refPrefix: 'Q', symbol: 'npn', valueDefault: 'BC547',
  description: 'NPN 45 V 100 mA, TO-92 (1=C 2=B 3=E)', pins: [p(1, 'C'), p(2, 'B'), p(3, 'E')], footprints: ['TO-92_Inline'] });
add({ id: '2N2222', name: '2N2222 NPN', category: 'Transistor', refPrefix: 'Q', symbol: 'npn', valueDefault: '2N2222',
  description: 'NPN 40 V 600 mA, TO-92 (1=E 2=B 3=C)', pins: [p(1, 'E'), p(2, 'B'), p(3, 'C')], footprints: ['TO-92_Inline'] });
add({ id: 'AO3400A', name: 'AO3400A N-MOSFET', category: 'Transistor', refPrefix: 'Q', symbol: 'nmos', valueDefault: 'AO3400A',
  description: 'N-channel logic-level MOSFET 30 V 5.7 A, SOT-23 (1=G 2=S 3=D)', pins: [p(1, 'G'), p(2, 'S'), p(3, 'D')], footprints: ['SOT-23'] });
add({ id: 'AO3401A', name: 'AO3401A P-MOSFET', category: 'Transistor', refPrefix: 'Q', symbol: 'pmos', valueDefault: 'AO3401A',
  description: 'P-channel MOSFET -30 V -4 A, SOT-23 (1=G 2=S 3=D)', pins: [p(1, 'G'), p(2, 'S'), p(3, 'D')], footprints: ['SOT-23'] });
add({ id: 'IRLZ44N', name: 'IRLZ44N N-MOSFET', category: 'Transistor', refPrefix: 'Q', symbol: 'nmos', valueDefault: 'IRLZ44N',
  description: 'N-channel logic-level MOSFET 55 V 47 A, TO-220 (1=G 2=D 3=S)', pins: [p(1, 'G'), p(2, 'D'), p(3, 'S')], footprints: ['TO-220-3_Vertical'] });

// ---------------------------------------------------------------- power
add({ id: 'AMS1117-3.3', name: 'AMS1117-3.3 LDO', category: 'Power', refPrefix: 'U', symbol: 'ic', valueDefault: 'AMS1117-3.3',
  description: '3.3 V 1 A LDO, SOT-223 (1=GND 2=VOUT 3=VIN 4=tab VOUT). Needs 10uF in/out.',
  pins: [p(3, 'VIN', 'left', 'power_in'), p(1, 'GND', 'left', 'power_in'), p(2, 'VOUT', 'right', 'power_out'), p(4, 'TAB', 'right', 'power_out')], footprints: ['SOT-223-3_TabPin2'] });
add({ id: 'AMS1117-5.0', name: 'AMS1117-5.0 LDO', category: 'Power', refPrefix: 'U', symbol: 'ic', valueDefault: 'AMS1117-5.0',
  description: '5 V 1 A LDO, SOT-223 (1=GND 2=VOUT 3=VIN 4=tab VOUT)',
  pins: [p(3, 'VIN', 'left', 'power_in'), p(1, 'GND', 'left', 'power_in'), p(2, 'VOUT', 'right', 'power_out'), p(4, 'TAB', 'right', 'power_out')], footprints: ['SOT-223-3_TabPin2'] });
add({ id: 'LM7805', name: 'LM7805 regulator', category: 'Power', refPrefix: 'U', symbol: 'ic', valueDefault: 'LM7805',
  description: '5 V 1.5 A linear regulator, TO-220 (1=IN 2=GND 3=OUT). 330nF in, 100nF out.',
  pins: [p(1, 'IN', 'left', 'power_in'), p(2, 'GND', 'left', 'power_in'), p(3, 'OUT', 'right', 'power_out')], footprints: ['TO-220-3_Vertical'] });
add({ id: 'AP2112K-3.3', name: 'AP2112K-3.3 LDO', category: 'Power', refPrefix: 'U', symbol: 'ic', valueDefault: 'AP2112K-3.3',
  description: '3.3 V 600 mA LDO, SOT-23-5 (1=VIN 2=GND 3=EN 4=NC 5=VOUT). 1uF in/out.',
  pins: [p(1, 'VIN', 'left', 'power_in'), p(3, 'EN', 'left'), p(2, 'GND', 'left', 'power_in'), p(5, 'VOUT', 'right', 'power_out'), p(4, 'NC', 'right', 'nc')], footprints: ['SOT-23-5'] });
add({ id: 'MCP1700-3302', name: 'MCP1700 3.3 V LDO', category: 'Power', refPrefix: 'U', symbol: 'ic', valueDefault: 'MCP1700-3302E',
  description: '3.3 V 250 mA low-Iq LDO, SOT-23 (1=GND 2=VOUT 3=VIN)',
  pins: [p(3, 'VIN', 'left', 'power_in'), p(1, 'GND', 'left', 'power_in'), p(2, 'VOUT', 'right', 'power_out')], footprints: ['SOT-23'] });
add({ id: 'MT3608', name: 'MT3608 boost converter', category: 'Power', refPrefix: 'U', symbol: 'ic', valueDefault: 'MT3608',
  description: '2 A boost converter, SOT-23-6 (1=SW 2=GND 3=FB 4=EN 5=IN 6=NC). Needs 22uH, schottky, FB divider.',
  pins: [p(5, 'IN', 'left', 'power_in'), p(4, 'EN', 'left'), p(2, 'GND', 'left', 'power_in'), p(1, 'SW', 'right'), p(3, 'FB', 'right'), p(6, 'NC', 'right', 'nc')], footprints: ['SOT-23-6'] });
add({ id: 'TP4056', name: 'TP4056 Li-ion charger', category: 'Power', refPrefix: 'U', symbol: 'ic', valueDefault: 'TP4056',
  description: '1 A single-cell Li-ion charger, SOIC-8-EP (1=TEMP 2=PROG 3=GND 4=VCC 5=BAT 6=STDBY 7=CHRG 8=CE 9=EP GND). PROG 1.2k = 1 A.',
  pins: [p(4, 'VCC', 'left', 'power_in'), p(8, 'CE', 'left'), p(1, 'TEMP', 'left'), p(2, 'PROG', 'left'), p(3, 'GND', 'left', 'power_in'), p(5, 'BAT', 'right', 'power_out'), p(7, 'CHRG', 'right'), p(6, 'STDBY', 'right'), p(9, 'EP', 'right', 'power_in')],
  footprints: ['SOIC-8-1EP_3.9x4.9mm_P1.27mm_EP2.41x3.3mm'] });

// ---------------------------------------------------------------- analog / logic ICs
add({ id: 'NE555', name: 'NE555 timer', category: 'IC', refPrefix: 'U', symbol: 'ic', valueDefault: 'NE555',
  description: '555 timer (astable/monostable) 4.5-16 V',
  pins: [p(8, 'VCC', 'left', 'power_in'), p(4, 'RESET', 'left'), p(2, 'TRIG', 'left'), p(6, 'THR', 'left'), p(1, 'GND', 'left', 'power_in'), p(3, 'OUT', 'right'), p(7, 'DIS', 'right'), p(5, 'CTRL', 'right')],
  footprints: ['DIP-8_W7.62mm', 'SOIC-8_3.9x5.2mm_P1.27mm'] });
add({ id: 'LM358', name: 'LM358 dual op-amp', category: 'IC', refPrefix: 'U', symbol: 'ic', valueDefault: 'LM358',
  description: 'Dual op-amp, single supply 3-32 V',
  pins: [p(3, 'INA+', 'left'), p(2, 'INA-', 'left'), p(5, 'INB+', 'left'), p(6, 'INB-', 'left'), p(8, 'V+', 'right', 'power_in'), p(1, 'OUTA', 'right'), p(7, 'OUTB', 'right'), p(4, 'V-', 'right', 'power_in')],
  footprints: ['SOIC-8_3.9x5.2mm_P1.27mm', 'DIP-8_W7.62mm', 'MSOP-8_3x3mm_P0.65mm'] });
add({ id: 'LM386', name: 'LM386 audio amp', category: 'IC', refPrefix: 'U', symbol: 'ic', valueDefault: 'LM386',
  description: 'Low-voltage audio power amplifier 0.5 W',
  pins: [p(3, 'IN+', 'left'), p(2, 'IN-', 'left'), p(1, 'GAIN1', 'left'), p(8, 'GAIN8', 'left'), p(7, 'BYPASS', 'left'), p(6, 'VS', 'right', 'power_in'), p(5, 'VOUT', 'right'), p(4, 'GND', 'right', 'power_in')],
  footprints: ['DIP-8_W7.62mm', 'SOIC-8_3.9x5.2mm_P1.27mm'] });
add({ id: 'PC817', name: 'PC817 optocoupler', category: 'IC', refPrefix: 'U', symbol: 'ic', valueDefault: 'PC817',
  description: 'Optocoupler (1=A 2=K 3=E 4=C)', pins: [p(1, 'A', 'left'), p(2, 'K', 'left'), p(4, 'C', 'right'), p(3, 'E', 'right')], footprints: ['DIP-4_W7.62mm'] });
add({ id: '74HC595', name: '74HC595 shift register', category: 'IC', refPrefix: 'U', symbol: 'ic', valueDefault: '74HC595',
  description: '8-bit serial-in parallel-out shift register 2-6 V',
  pins: [p(16, 'VCC', 'left', 'power_in'), p(14, 'SER', 'left'), p(11, 'SRCLK', 'left'), p(12, 'RCLK', 'left'), p(10, 'SRCLR', 'left'), p(13, 'OE', 'left'), p(8, 'GND', 'left', 'power_in'),
    p(15, 'QA', 'right'), p(1, 'QB', 'right'), p(2, 'QC', 'right'), p(3, 'QD', 'right'), p(4, 'QE', 'right'), p(5, 'QF', 'right'), p(6, 'QG', 'right'), p(7, 'QH', 'right'), p(9, 'QH\'', 'right')],
  footprints: ['SOIC-16_3.9x10.3mm_P1.27mm', 'DIP-16_W7.62mm', 'TSSOP-16_4.4x5.6mm_P0.65mm'] });
add({ id: 'ULN2003A', name: 'ULN2003A Darlington array', category: 'IC', refPrefix: 'U', symbol: 'ic', valueDefault: 'ULN2003A',
  description: '7-channel 500 mA Darlington sink driver with flyback diodes',
  pins: [...[1, 2, 3, 4, 5, 6, 7].map((n) => p(n, `IN${n}`, 'left')), p(8, 'GND', 'left', 'power_in'), ...[16, 15, 14, 13, 12, 11, 10].map((n, i) => p(n, `OUT${i + 1}`, 'right')), p(9, 'COM', 'right')],
  footprints: ['DIP-16_W7.62mm', 'SOIC-16_3.9x10.3mm_P1.27mm'] });
add({ id: 'DS18B20', name: 'DS18B20 temperature sensor', category: 'Sensor', refPrefix: 'U', symbol: 'ic', valueDefault: 'DS18B20',
  description: '1-Wire digital thermometer, TO-92 (1=GND 2=DQ 3=VDD). 4.7k pull-up on DQ.',
  pins: [p(3, 'VDD', 'left', 'power_in'), p(1, 'GND', 'left', 'power_in'), p(2, 'DQ', 'right')], footprints: ['TO-92_Inline'] });

// ---------------------------------------------------------------- MCUs / interface
add({ id: 'ATMEGA328P-PU', name: 'ATmega328P (DIP-28)', category: 'MCU', refPrefix: 'U', symbol: 'ic', valueDefault: 'ATmega328P-PU',
  description: 'AVR 8-bit MCU (Arduino Uno chip), DIP-28. 16 MHz crystal + 2x22pF, 100nF on VCC/AVCC, 10k RESET pull-up.',
  pins: [p(1, 'PC6/RESET', 'left'), p(7, 'VCC', 'left', 'power_in'), p(20, 'AVCC', 'left', 'power_in'), p(21, 'AREF', 'left'), p(8, 'GND', 'left', 'power_in'), p(22, 'GND', 'left', 'power_in'), p(9, 'PB6/XTAL1', 'left'), p(10, 'PB7/XTAL2', 'left'),
    p(2, 'PD0/RXD', 'left'), p(3, 'PD1/TXD', 'left'), p(4, 'PD2', 'left'), p(5, 'PD3', 'left'), p(6, 'PD4', 'left'), p(11, 'PD5', 'left'),
    p(12, 'PD6', 'right'), p(13, 'PD7', 'right'), p(14, 'PB0', 'right'), p(15, 'PB1', 'right'), p(16, 'PB2/SS', 'right'), p(17, 'PB3/MOSI', 'right'), p(18, 'PB4/MISO', 'right'), p(19, 'PB5/SCK', 'right'),
    p(23, 'PC0/ADC0', 'right'), p(24, 'PC1/ADC1', 'right'), p(25, 'PC2/ADC2', 'right'), p(26, 'PC3/ADC3', 'right'), p(27, 'PC4/SDA', 'right'), p(28, 'PC5/SCL', 'right')],
  footprints: ['DIP-28_W7.62mm'] });
add({ id: 'ESP32-WROOM-32', name: 'ESP32-WROOM-32 module', category: 'MCU', refPrefix: 'U', symbol: 'ic', valueDefault: 'ESP32-WROOM-32',
  description: 'Wi-Fi + Bluetooth module, 3.3 V. EN needs 10k pull-up + 1uF to GND; IO0 10k pull-up + BOOT button to GND; 10uF + 100nF on 3V3.',
  pins: [p(2, '3V3', 'left', 'power_in'), p(1, 'GND', 'left', 'power_in'), p(15, 'GND', 'left', 'power_in'), p(38, 'GND', 'left', 'power_in'), p(39, 'GND_PAD', 'left', 'power_in'), p(3, 'EN', 'left'),
    p(4, 'SENSOR_VP/IO36', 'left'), p(5, 'SENSOR_VN/IO39', 'left'), p(6, 'IO34', 'left'), p(7, 'IO35', 'left'), p(8, 'IO32', 'left'), p(9, 'IO33', 'left'), p(10, 'IO25', 'left'), p(11, 'IO26', 'left'), p(12, 'IO27', 'left'), p(13, 'IO14', 'left'), p(14, 'IO12', 'left'),
    p(16, 'IO13', 'right'), p(17, 'SD2', 'right', 'nc'), p(18, 'SD3', 'right', 'nc'), p(19, 'CMD', 'right', 'nc'), p(20, 'CLK', 'right', 'nc'), p(21, 'SD0', 'right', 'nc'), p(22, 'SD1', 'right', 'nc'), p(23, 'IO15', 'right'), p(24, 'IO2', 'right'),
    p(25, 'IO0', 'right'), p(26, 'IO4', 'right'), p(27, 'IO16', 'right'), p(28, 'IO17', 'right'), p(29, 'IO5', 'right'), p(30, 'IO18', 'right'), p(31, 'IO19', 'right'), p(32, 'NC', 'right', 'nc'), p(33, 'IO21', 'right'), p(34, 'RXD0', 'right'), p(35, 'TXD0', 'right'), p(36, 'IO22', 'right'), p(37, 'IO23', 'right')],
  footprints: ['ESP32-WROOM-32'] });
add({ id: 'CH340C', name: 'CH340C USB-UART', category: 'Interface', refPrefix: 'U', symbol: 'ic', valueDefault: 'CH340C',
  description: 'USB to UART bridge with internal oscillator, SOIC-16. 100nF on VCC and V3 (V3 tied to VCC at 3.3 V).',
  pins: [p(16, 'VCC', 'left', 'power_in'), p(4, 'V3', 'left', 'power_in'), p(5, 'UD+', 'left'), p(6, 'UD-', 'left'), p(1, 'GND', 'left', 'power_in'), p(15, 'R232', 'left'), p(7, 'NC', 'left', 'nc'), p(8, 'NC', 'left', 'nc'),
    p(2, 'TXD', 'right'), p(3, 'RXD', 'right'), p(13, 'DTR', 'right'), p(14, 'RTS', 'right'), p(9, 'CTS', 'right'), p(10, 'DSR', 'right'), p(11, 'RI', 'right'), p(12, 'DCD', 'right')],
  footprints: ['SOIC-16_3.9x10.3mm_P1.27mm'] });

// ---------------------------------------------------------------- electromech
add({ id: 'SW_PUSH', name: 'Push button', category: 'Switch', refPrefix: 'SW', symbol: 'switch', valueDefault: 'SW_Push',
  description: 'Momentary tactile push button (normally open)', pins: [p(1, '1'), p(2, '2')], footprints: ['SW_PUSH_6mm', 'SW_SPST_SMD_5.2x5.2mm'] });
add({ id: 'BUZZER', name: 'Buzzer', category: 'Audio', refPrefix: 'BZ', symbol: 'buzzer', valueDefault: 'Buzzer',
  description: 'Magnetic / piezo buzzer, pin 1 = +', pins: [p(1, '+'), p(2, '-')], footprints: ['Buzzer_12x9.5mm_P7.6mm'] });
add({ id: 'RELAY_SPDT', name: 'Relay SPDT 5 V', category: 'Relay', refPrefix: 'K', symbol: 'ic', valueDefault: 'SRD-05VDC-SL-C',
  description: 'SPDT relay, 5 V coil (add flyback diode across coil + transistor driver)',
  pins: [p(2, 'COIL1', 'left'), p(5, 'COIL2', 'left'), p(1, 'COM', 'right'), p(4, 'NO', 'right'), p(3, 'NC', 'right')], footprints: ['Relay_SRD-05VDC'] });
add({ id: 'MOUNTING_HOLE', name: 'Mounting hole', category: 'Mechanical', refPrefix: 'H', symbol: 'connector', valueDefault: 'M3',
  description: 'Plated mounting hole (connect to GND or leave unconnected)', pins: [p(1, '1', 'left')], footprints: ['MountingHole_3.2mm_M3', 'MountingHole_2.2mm_M2', 'MountingHole_4.3mm_M4'] });
add({ id: 'TEST_POINT', name: 'Test point', category: 'Mechanical', refPrefix: 'TP', symbol: 'connector', valueDefault: 'TP',
  description: 'Test pad', pins: [p(1, '1', 'left')], footprints: ['TestPoint_Pad_D1.5mm'] });

// ---------------------------------------------------------------- connectors
for (let n = 1; n <= 20; n++) {
  const nn = String(n).padStart(2, '0');
  const fps = [`PinHeader_1x${nn}_P2.54mm_Vertical`];
  if (n >= 2 && n <= 12) fps.push(`JST_XH_B${n}B-XH-A_1x${nn}_P2.50mm_Vertical`, `JST_PH_B${n}B-PH-K_1x${nn}_P2.00mm_Vertical`, `TerminalBlock_1x${nn}_P5.08mm`, `TerminalBlock_1x${nn}_P3.50mm`);
  add({ id: `CONN_1x${nn}`, name: `Connector 1x${n}`, category: 'Connector', refPrefix: 'J', symbol: 'connector', valueDefault: `Conn_01x${nn}`,
    description: `Generic ${n}-pin single-row connector (pin header, JST, screw terminal)`, pins: Array.from({ length: n }, (_, i) => p(i + 1, `Pin_${i + 1}`, 'left')), footprints: fps });
}
for (const n of [2, 3, 4, 5, 6, 8, 10, 13, 20]) {
  const nn = String(n).padStart(2, '0');
  add({ id: `CONN_2x${nn}`, name: `Connector 2x${n}`, category: 'Connector', refPrefix: 'J', symbol: 'connector', valueDefault: `Conn_02x${nn}`,
    description: `Generic 2x${n} pin header (odd/even numbering; 2x3 = AVR ISP)`, pins: Array.from({ length: 2 * n }, (_, i) => p(i + 1, `Pin_${i + 1}`, 'left')), footprints: [`PinHeader_2x${nn}_P2.54mm_Vertical`] });
}
add({ id: 'USB_C_POWER', name: 'USB-C receptacle (USB 2.0)', category: 'Connector', refPrefix: 'J', symbol: 'ic', valueDefault: 'USB_C_Receptacle',
  description: 'USB Type-C 16P. For a sink: 5.1k from CC1 and CC2 to GND each. Join A6+B6 (D+) and A7+B7 (D-).',
  pins: [p('A4', 'VBUS', 'left', 'power_out'), p('A9', 'VBUS', 'left', 'power_out'), p('B4', 'VBUS', 'left', 'power_out'), p('B9', 'VBUS', 'left', 'power_out'),
    p('A1', 'GND', 'left', 'power_in'), p('A12', 'GND', 'left', 'power_in'), p('B1', 'GND', 'left', 'power_in'), p('B12', 'GND', 'left', 'power_in'), p('S1', 'SHIELD', 'left'),
    p('A5', 'CC1', 'right'), p('B5', 'CC2', 'right'), p('A6', 'D+', 'right'), p('B6', 'D+', 'right'), p('A7', 'D-', 'right'), p('B7', 'D-', 'right'), p('A8', 'SBU1', 'right', 'nc'), p('B8', 'SBU2', 'right', 'nc')],
  footprints: ['USB_C_Receptacle_16P'] });
add({ id: 'USB_MICRO_B', name: 'Micro-USB B receptacle', category: 'Connector', refPrefix: 'J', symbol: 'ic', valueDefault: 'USB_Micro-B',
  description: 'Micro USB B (1=VBUS 2=D- 3=D+ 4=ID 5=GND 6=shield)',
  pins: [p(1, 'VBUS', 'left', 'power_out'), p(5, 'GND', 'left', 'power_in'), p(6, 'SHIELD', 'left'), p(3, 'D+', 'right'), p(2, 'D-', 'right'), p(4, 'ID', 'right', 'nc')], footprints: ['USB_Micro-B'] });
add({ id: 'BARREL_JACK', name: 'DC barrel jack', category: 'Connector', refPrefix: 'J', symbol: 'ic', valueDefault: 'BarrelJack',
  description: 'DC jack 5.5/2.1 mm (1=centre +, 2=sleeve GND, 3=switch)', pins: [p(1, 'CENTER', 'right', 'power_out'), p(2, 'SLEEVE', 'right', 'power_out'), p(3, 'SWITCH', 'right')], footprints: ['BarrelJack_5.5x2.1mm'] });
add({ id: 'BATTERY', name: 'Battery connector', category: 'Connector', refPrefix: 'BT', symbol: 'connector', valueDefault: 'Battery',
  description: 'Battery lead connector (1=+ 2=-), JST PH by default', pins: [p(1, '+', 'left'), p(2, '-', 'left')], footprints: ['JST_PH_B2B-PH-K_1x02_P2.00mm_Vertical', 'JST_XH_B2B-XH-A_1x02_P2.50mm_Vertical', 'TerminalBlock_1x02_P5.08mm'] });

const BY_ID = new Map(parts.map((c) => [c.id.toUpperCase(), c]));

export function listComponents() { return parts; }
export function getComponent(id) { return BY_ID.get(String(id).toUpperCase()) ?? null; }

/** Compact text catalog for the AI prompt. */
export function catalogText() {
  return parts.map((c) => {
    const pins = c.pins.map((x) => `${x.num}:${x.name}`).join(' ');
    return `${c.id} | ${c.category} | ${c.description} | default value: ${c.valueDefault} | pins: ${pins} | footprints: ${c.footprints.join(', ')}`;
  }).join('\n');
}
