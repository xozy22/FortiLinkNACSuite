// ---------------------------------------------------------------------------
// Demo-FortiGate: vollstaendig im Speicher.
//
// Host "demo" laesst die gesamte App ohne echtes Geraet laufen – inklusive
// Schreibvorgaengen, die im Mock persistiert werden. Damit sind UI-Arbeit,
// Screenshots und ein realistischer Durchlauf des Plan-&-Apply-Flows moeglich.
//
// Die Antwortformate bilden FortiOS nach (results-Array, status/http_status,
// mkey bei Schreibvorgaengen), damit der restliche Code nicht zwischen Demo
// und Echtbetrieb unterscheiden muss.
// ---------------------------------------------------------------------------

const VERSION = 'v7.6.7';
const BUILD = 3704;
const SERIAL = 'FGVMDEMO0000001';

// ---------------------------------------------------------------------------
// Seed-Daten
// ---------------------------------------------------------------------------

// Wie auf einer echten FortiGate: Die FortiLink-Schnittstelle ist ein
// aggregate-Interface mit fortilink=enable – es gibt keinen type "fortilink".
// Alles andere ist ein normales VLAN, das per "interface" darunter haengt.
const vlan = (name, vlanid, ip, feature = 'none') => ({
  name,
  vlanid,
  type: 'vlan',
  interface: 'fortilink',
  ip,
  status: 'up',
  fortilink: 'disable',
  role: 'lan',
  'switch-controller-feature': feature,
});

const VLANS = [
  {
    name: 'fortilink',
    vlanid: 0,
    type: 'aggregate',
    interface: '',
    ip: '10.255.1.1 255.255.255.0',
    status: 'up',
    fortilink: 'enable',
    role: 'lan',
    'switch-controller-feature': 'none',
  },
  { name: 'wan1', vlanid: 0, type: 'physical', interface: '', ip: '203.0.113.2 255.255.255.0', status: 'up', fortilink: 'disable', role: 'wan', 'switch-controller-feature': 'none' },
  vlan('VL10_CLIENTS', 10, '10.10.10.1 255.255.255.0', 'default-vlan'),
  vlan('VL20_VOICE', 20, '10.10.20.1 255.255.255.0', 'voice'),
  vlan('VL30_PRINT', 30, '10.10.30.1 255.255.255.0'),
  vlan('VL40_CAM', 40, '10.10.40.1 255.255.255.0', 'video'),
  vlan('VL50_WIFI_MGMT', 50, '10.10.50.1 255.255.255.0'),
  vlan('VL99_QUARANTINE', 99, '10.10.99.1 255.255.255.0', 'quarantine'),
  vlan('VL100_ONBOARD', 100, '10.10.100.1 255.255.255.0', 'nac'),
];

const LLDP_PROFILES = [
  { name: 'default' },
  { name: 'default-auto-isl' },
  { name: 'default-auto-mclag-icl' },
  { name: 'voice-lldp-med' },
];

const QOS_POLICIES = [{ name: 'default' }, { name: 'voice-priority' }];

const SEC_POLICIES = [
  { name: '802-1X-policy-default', 'security-mode': '802.1X' },
  { name: 'dot1x-mab-fallback', 'security-mode': '802.1X-mac-based' },
];

const INTERFACE_TAGS = [{ name: 'uplink' }, { name: 'access-floor1' }, { name: 'access-floor2' }, { name: 'lab' }];

const VLAN_POLICIES = [
  {
    name: 'VP-Clients',
    description: 'Standard client access',
    fortilink: 'fortilink',
    vlan: 'VL10_CLIENTS',
    'allowed-vlans': [],
    'untagged-vlans': [],
    'allowed-vlans-all': 'disable',
    'discard-mode': 'none',
  },
  {
    name: 'VP-Voice',
    description: 'VoIP phone with client passthrough',
    fortilink: 'fortilink',
    vlan: 'VL10_CLIENTS',
    'allowed-vlans': [{ 'vlan-name': 'VL20_VOICE' }],
    'untagged-vlans': [],
    'allowed-vlans-all': 'disable',
    'discard-mode': 'none',
  },
  {
    name: 'VP-Printer',
    description: 'Printers, no tagged traffic',
    fortilink: 'fortilink',
    vlan: 'VL30_PRINT',
    'allowed-vlans': [],
    'untagged-vlans': [],
    'allowed-vlans-all': 'disable',
    'discard-mode': 'all-tagged',
  },
  {
    name: 'VP-Camera',
    description: 'IP cameras',
    fortilink: 'fortilink',
    vlan: 'VL40_CAM',
    'allowed-vlans': [],
    'untagged-vlans': [],
    'allowed-vlans-all': 'disable',
    'discard-mode': 'all-tagged',
  },
  {
    name: 'VP-Quarantine',
    description: 'Unknown devices',
    fortilink: 'fortilink',
    vlan: 'VL99_QUARANTINE',
    'allowed-vlans': [],
    'untagged-vlans': [],
    'allowed-vlans-all': 'disable',
    'discard-mode': 'none',
  },
];

function rule(over) {
  return {
    name: '',
    description: '',
    status: 'enable',
    category: 'device',
    'match-type': 'dynamic',
    'match-period': 0,
    'match-remove': 'default',
    'interface-tags': [],
    mac: '',
    'hw-vendor': '',
    type: '',
    family: '',
    host: '',
    'lldp-profile': '',
    'qos-policy': '',
    '802-1x': '',
    'vlan-policy': '',
    'bounce-port-link': 'enable',
    'bounce-port-duration': 5,
    'poe-reset': 'disable',
    ...over,
  };
}

const DYNAMIC_PORT_POLICIES = [
  {
    name: 'DPP-Access',
    description: 'Access ports floor 1 and 2',
    fortilink: 'fortilink',
    policy: [
      rule({
        name: 'R10-VoIP-Phones',
        description: 'Fortinet and Yealink desk phones',
        'hw-vendor': 'Fortinet',
        type: 'IP Phone',
        'vlan-policy': 'VP-Voice',
        'lldp-profile': 'voice-lldp-med',
        'qos-policy': 'voice-priority',
      }),
      rule({
        name: 'R20-Printers',
        description: 'Network printers',
        'hw-vendor': 'Hewlett Pack',
        type: 'Printer',
        'vlan-policy': 'VP-Printer',
        'poe-reset': 'disable',
      }),
      rule({
        name: 'R30-Cameras',
        description: 'Axis IP cameras',
        'hw-vendor': 'Axis Comm',
        'vlan-policy': 'VP-Camera',
        'poe-reset': 'enable',
      }),
      rule({
        name: 'R40-Windows-PC',
        description: 'Domain workstations',
        type: 'Windows PC',
        'vlan-policy': 'VP-Clients',
      }),
      rule({
        name: 'R99-Catch-All',
        description: 'Everything else goes to quarantine',
        'vlan-policy': 'VP-Quarantine',
        'bounce-port-link': 'disable',
      }),
    ],
  },
  {
    name: 'DPP-Lab',
    description: 'Lab bench ports, tag driven',
    fortilink: 'fortilink',
    policy: [
      rule({
        name: 'R10-Lab-Tagged',
        category: 'interface-tag',
        'interface-tags': [{ 'tag-name': 'lab' }],
        'vlan-policy': 'VP-Clients',
      }),
    ],
  },
];

// --- Geraete ---------------------------------------------------------------

function dev(mac, over) {
  return {
    mac,
    master_mac: mac,
    is_master_device: true,
    hardware_vendor: '',
    hardware_type: '',
    hardware_family: '',
    os_name: '',
    os_version: '',
    hostname: '',
    host_src: 'dhcp',
    ipv4_address: '',
    is_online: true,
    last_seen: 30,
    active_start_time: 1_770_000_000,
    detected_interface: 'fortilink',
    purdue_level: '3',
    dhcp_lease_status: 'leased',
    is_fortiguard_src: true,
    ...over,
  };
}

const DEVICES = [
  // VoIP-Telefone
  dev('00:09:0f:aa:10:01', { hardware_vendor: 'Fortinet', hardware_type: 'IP Phone', hardware_family: 'FortiFone', hostname: 'FON-1001', ipv4_address: '10.10.20.31', os_name: 'FortiFone OS', os_version: '3.6.1' }),
  dev('00:09:0f:aa:10:02', { hardware_vendor: 'Fortinet', hardware_type: 'IP Phone', hardware_family: 'FortiFone', hostname: 'FON-1002', ipv4_address: '10.10.20.32', os_name: 'FortiFone OS', os_version: '3.6.1' }),
  dev('80:5e:c0:bb:20:11', { hardware_vendor: 'Yealink', hardware_type: 'IP Phone', hardware_family: 'T4 Series', hostname: 'FON-2011', ipv4_address: '10.10.20.44' }),
  dev('80:5e:c0:bb:20:12', { hardware_vendor: 'Yealink', hardware_type: 'IP Phone', hardware_family: 'T4 Series', hostname: 'FON-2012', ipv4_address: '10.10.20.45', is_online: false, last_seen: 8400 }),

  // Drucker
  dev('3c:2a:f4:11:00:01', { hardware_vendor: 'Brother', hardware_type: 'Printer', hardware_family: 'HL Series', hostname: 'PRN-LOGISTIK', ipv4_address: '10.10.30.21' }),
  dev('98:e7:f4:22:00:02', { hardware_vendor: 'Hewlett Packard', hardware_type: 'Printer', hardware_family: 'LaserJet', hostname: 'PRN-BUERO-1', ipv4_address: '10.10.30.22' }),
  dev('98:e7:f4:22:00:03', { hardware_vendor: 'Hewlett Packard', hardware_type: 'Printer', hardware_family: 'LaserJet', hostname: 'PRN-BUERO-2', ipv4_address: '10.10.30.23' }),
  dev('00:1b:a9:33:00:04', { hardware_vendor: 'Brother', hardware_type: 'Printer', hardware_family: 'MFC Series', hostname: 'PRN-EMPFANG', ipv4_address: '10.10.30.24' }),

  // Kameras
  dev('00:40:8c:cc:30:01', { hardware_vendor: 'Axis Communications', hardware_type: 'IP Camera', hardware_family: 'P Series', hostname: 'CAM-EINGANG', ipv4_address: '10.10.40.11' }),
  dev('00:40:8c:cc:30:02', { hardware_vendor: 'Axis Communications', hardware_type: 'IP Camera', hardware_family: 'P Series', hostname: 'CAM-LAGER', ipv4_address: '10.10.40.12' }),
  dev('00:40:8c:cc:30:03', { hardware_vendor: 'Axis Communications', hardware_type: 'IP Camera', hardware_family: 'M Series', hostname: 'CAM-PARKPLATZ', ipv4_address: '10.10.40.13' }),
  dev('bc:ad:28:dd:30:04', { hardware_vendor: 'Hikvision', hardware_type: 'IP Camera', hardware_family: 'DS Series', hostname: 'CAM-HOF', ipv4_address: '10.10.40.14' }),

  // Windows-PCs
  dev('a4:bb:6d:40:00:01', { hardware_vendor: 'Dell', hardware_type: 'Windows PC', hardware_family: 'OptiPlex', os_name: 'Windows', os_version: '11 23H2', hostname: 'WS-BUCHHALTUNG', ipv4_address: '10.10.10.51', host_src: 'dhcp' }),
  dev('a4:bb:6d:40:00:02', { hardware_vendor: 'Dell', hardware_type: 'Windows PC', hardware_family: 'OptiPlex', os_name: 'Windows', os_version: '11 23H2', hostname: 'WS-EINKAUF', ipv4_address: '10.10.10.52' }),
  dev('54:bf:64:40:00:03', { hardware_vendor: 'Dell', hardware_type: 'Windows PC', hardware_family: 'Latitude', os_name: 'Windows', os_version: '11 24H2', hostname: 'NB-VERTRIEB-3', ipv4_address: '10.10.10.53' }),
  dev('8c:16:45:40:00:04', { hardware_vendor: 'Lenovo', hardware_type: 'Windows PC', hardware_family: 'ThinkPad', os_name: 'Windows', os_version: '10 22H2', hostname: 'NB-TECHNIK-1', ipv4_address: '10.10.10.54' }),
  dev('8c:16:45:40:00:05', { hardware_vendor: 'Lenovo', hardware_type: 'Windows PC', hardware_family: 'ThinkCentre', os_name: 'Windows', os_version: '11 23H2', hostname: 'WS-EMPFANG', ipv4_address: '10.10.10.55', is_online: false, last_seen: 260_000 }),

  // PCs hinter den Tischtelefonen – der Regelfall in einer Voice-Installation:
  // zwei MACs an einem Port, Telefon getaggt im Voice-VLAN, PC untagged.
  dev('a4:bb:6d:40:00:06', { hardware_vendor: 'Dell', hardware_type: 'Windows PC', hardware_family: 'OptiPlex', os_name: 'Windows', os_version: '11 23H2', hostname: 'WS-TELEFONIE-1', ipv4_address: '10.10.10.61' }),
  dev('a4:bb:6d:40:00:07', { hardware_vendor: 'Dell', hardware_type: 'Windows PC', hardware_family: 'OptiPlex', os_name: 'Windows', os_version: '11 23H2', hostname: 'WS-TELEFONIE-2', ipv4_address: '10.10.10.62', is_online: false, last_seen: 5400 }),

  // Access Points
  dev('90:6c:ac:50:00:01', { hardware_vendor: 'Fortinet', hardware_type: 'Wireless AP', hardware_family: 'FortiAP', os_name: 'FortiAP', os_version: '7.4.4', hostname: 'FAP-EG-01', ipv4_address: '10.10.50.11' }),
  dev('90:6c:ac:50:00:02', { hardware_vendor: 'Fortinet', hardware_type: 'Wireless AP', hardware_family: 'FortiAP', os_name: 'FortiAP', os_version: '7.4.4', hostname: 'FAP-OG-01', ipv4_address: '10.10.50.12' }),

  // OT / Sonderfaelle
  dev('00:30:de:60:00:01', { hardware_vendor: 'Wago Kontakttechnik', hardware_type: 'PLC', hardware_family: 'PFC200', hostname: 'PLC-HALLE-1', ipv4_address: '10.10.10.90', purdue_level: '2' }),
  dev('00:0c:29:70:00:01', { hardware_vendor: 'VMware', hardware_type: 'Server', hardware_family: 'Virtual Machine', os_name: 'Linux', os_version: 'Debian 12', hostname: 'srv-monitoring', ipv4_address: '10.10.10.200' }),
  dev('b8:27:eb:80:00:01', { hardware_vendor: 'Raspberry Pi Foundation', hardware_type: 'Linux PC', hardware_family: 'Raspberry Pi', os_name: 'Linux', os_version: 'Raspbian 12', hostname: 'rpi-signage', ipv4_address: '10.10.10.201' }),

  // Tischswitch im Besprechungsraum – viele MACs hinter einem Port. Der Fall,
  // wegen dem man NAC ueberhaupt betreibt, und der Grund fuer eine scrollbare Liste.
  dev('3c:52:82:90:00:01', { hardware_vendor: 'Dell', hardware_type: 'Windows PC', hardware_family: 'Latitude', os_name: 'Windows', os_version: '11 24H2', hostname: 'NB-GAST-01', ipv4_address: '10.10.10.120' }),
  dev('3c:52:82:90:00:02', { hardware_vendor: 'Dell', hardware_type: 'Windows PC', hardware_family: 'Latitude', os_name: 'Windows', os_version: '11 24H2', hostname: 'NB-GAST-02', ipv4_address: '10.10.10.121' }),
  dev('f4:d4:88:90:00:03', { hardware_vendor: 'Apple', hardware_type: 'Mac', hardware_family: 'MacBook Pro', os_name: 'macOS', os_version: '15.2', hostname: 'MBP-DESIGN', ipv4_address: '10.10.10.122' }),
  dev('f4:d4:88:90:00:04', { hardware_vendor: 'Apple', hardware_type: 'Mac', hardware_family: 'MacBook Air', os_name: 'macOS', os_version: '15.1', hostname: 'MBA-MARKETING', ipv4_address: '10.10.10.123', is_online: false, last_seen: 3300 }),
  dev('8c:16:45:90:00:05', { hardware_vendor: 'Lenovo', hardware_type: 'Windows PC', hardware_family: 'ThinkPad', os_name: 'Windows', os_version: '11 23H2', hostname: 'NB-EXTERN-1', ipv4_address: '10.10.10.124' }),
  dev('00:e0:4c:90:00:06', { hardware_vendor: 'Realtek', hardware_type: '', hostname: '', ipv4_address: '10.10.10.125', host_src: '', is_fortiguard_src: false }),
  dev('54:2a:1b:90:00:07', { hardware_vendor: 'Logitech', hardware_type: 'Video Conferencing', hardware_family: 'Rally', hostname: 'RALLY-BESPR-1', ipv4_address: '10.10.10.126' }),
  dev('b0:be:76:90:00:08', { hardware_vendor: 'TP-Link', hardware_type: 'Switch', hostname: '', ipv4_address: '10.10.10.127', host_src: '', is_fortiguard_src: false }),
  dev('e4:5f:01:90:00:09', { hardware_vendor: 'Raspberry Pi Foundation', hardware_type: 'Linux PC', hardware_family: 'Raspberry Pi', os_name: 'Linux', os_version: 'Raspbian 12', hostname: 'rpi-raumanzeige', ipv4_address: '10.10.10.128' }),

  // Unbekannt / ohne Zuordnung
  dev('4a:1c:88:99:aa:01', { hardware_vendor: '', hardware_type: '', hostname: '', ipv4_address: '10.10.100.61', host_src: '', is_fortiguard_src: false }),
  dev('6e:32:11:5f:cd:02', { hardware_vendor: '', hardware_type: '', hostname: '', ipv4_address: '10.10.100.62', host_src: '', is_fortiguard_src: false }),
  dev('f0:9f:c2:aa:bb:03', { hardware_vendor: 'Ubiquiti Networks', hardware_type: 'Router', hostname: 'unknown-uap', ipv4_address: '10.10.100.63' }),
];

// --- Switches / Ports ------------------------------------------------------

function port(name, over) {
  return {
    'port-name': name,
    description: '',
    status: 'up',
    'access-mode': 'static',
    'port-policy': '',
    'matched-dpp-policy': '',
    'matched-dpp-intf-tags': '',
    'interface-tags': [],
    vlan: 'VL10_CLIENTS',
    'allowed-vlans': [],
    'untagged-vlans': [],
    'allowed-vlans-all': 'disable',
    'poe-status': 'enable',
    'lldp-profile': 'default-auto-isl',
    'qos-policy': 'default',
    'port-security-policy': '',
    'learning-limit': 0,
    'sticky-mac': 'disable',
    ...over,
  };
}

// Port-Beschreibungen, wie sie in einer gepflegten Anlage stehen wuerden.
const PORT_DESC = {
  'S248EF0000001|port1': 'Buero 1.01 - Dose A',
  'S248EF0000001|port2': 'Buero 1.01 - Dose B',
  'S248EF0000001|port3': 'Buero 1.02 - Dose A',
  'S248EF0000001|port4': 'Buero 1.02 - Dose B',
  'S248EF0000001|port5': 'Logistik - Drucker',
  'S248EF0000001|port6': 'Buero 1.03 - Drucker',
  'S248EF0000001|port7': 'Empfang - Drucker',
  'S248EF0000001|port8': 'Kamera Eingang Nord',
  'S248EF0000001|port9': 'Kamera Lager',
  'S248EF0000001|port10': 'Buchhaltung AP1',
  'S248EF0000001|port11': 'Einkauf AP1',
  'S248EF0000001|port12': 'Vertrieb Dockingstation',
  'S248EF0000001|port13': 'FortiAP EG',
  'S248EF0000001|port14': 'Besprechungsraum gross - Tischswitch',
  'S248EF0000001|port20': 'DEFEKT - nicht patchen',
  'S248EF0000001|port23': 'Uplink FortiGate port3',
  'S248EF0000001|port24': 'Uplink FortiGate port4 (LACP)',
  'S124EN0000002|port1': 'Buero 2.01 - Drucker',
  'S124EN0000002|port2': 'Kamera Parkplatz',
  'S124EN0000002|port3': 'Kamera Hof',
  'S124EN0000002|port4': 'Technik AP1',
  'S124EN0000002|port5': 'Empfang AP1',
  'S124EN0000002|port6': 'Schaltschrank Halle 1',
  'S124EN0000002|port9': 'Laborplatz 1',
  'S124EN0000002|port10': 'Laborplatz 2',
  'S124EN0000002|port11': 'FortiAP OG',
  'S124EN0000002|port12': 'Uplink zu S248EF0000001',
};

const withDesc = (switchId, p) => ({ ...p, description: PORT_DESC[`${switchId}|${p['port-name']}`] ?? p.description ?? '' });

const SWITCHES = [
  {
    'switch-id': 'S248EF0000001',
    sn: 'S248EF0000001',
    description: 'Floor 1 access switch',
    type: 'physical',
    ports: [
      ...Array.from({ length: 12 }, (_, i) =>
        port(`port${i + 1}`, {
          'access-mode': 'dynamic',
          'port-policy': 'DPP-Access',
          'interface-tags': [{ 'tag-name': 'access-floor1' }],
        })
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        // port20 ist administrativ abgeschaltet – der interessante Sonderfall.
        port(`port${i + 13}`, i + 13 === 20 ? { status: 'down' } : {})
      ),
      port('port23', { 'interface-tags': [{ 'tag-name': 'uplink' }], 'lldp-profile': 'default-auto-isl' }),
      port('port24', { 'interface-tags': [{ 'tag-name': 'uplink' }], 'lldp-profile': 'default-auto-isl' }),
    ].map((p) => withDesc('S248EF0000001', p)),
  },
  {
    'switch-id': 'S124EN0000002',
    sn: 'S124EN0000002',
    description: 'Floor 2 access switch',
    type: 'physical',
    ports: [
      ...Array.from({ length: 8 }, (_, i) =>
        port(`port${i + 1}`, {
          'access-mode': 'dynamic',
          'port-policy': 'DPP-Access',
          'interface-tags': [{ 'tag-name': 'access-floor2' }],
        })
      ),
      ...Array.from({ length: 2 }, (_, i) =>
        port(`port${i + 9}`, { 'access-mode': 'dynamic', 'port-policy': 'DPP-Lab', 'interface-tags': [{ 'tag-name': 'lab' }] })
      ),
      port('port11'),
      port('port12', { 'interface-tags': [{ 'tag-name': 'uplink' }] }),
    ].map((p) => withDesc('S124EN0000002', p)),
  },
];

// Wo haengt welches Geraet? Bestimmt detected-device und matched-devices.
const PLACEMENT = [
  ['00:09:0f:aa:10:01', 'S248EF0000001', 'port1', 20],
  ['00:09:0f:aa:10:02', 'S248EF0000001', 'port2', 20],
  // Dieselben Ports wie die Telefone darueber – PC haengt am Switch des Telefons.
  ['a4:bb:6d:40:00:06', 'S248EF0000001', 'port1', 10],
  ['a4:bb:6d:40:00:07', 'S248EF0000001', 'port2', 10],
  ['80:5e:c0:bb:20:11', 'S248EF0000001', 'port3', 20],
  ['80:5e:c0:bb:20:12', 'S248EF0000001', 'port4', 20],
  ['3c:2a:f4:11:00:01', 'S248EF0000001', 'port5', 30],
  ['98:e7:f4:22:00:02', 'S248EF0000001', 'port6', 30],
  ['98:e7:f4:22:00:03', 'S124EN0000002', 'port1', 30],
  ['00:1b:a9:33:00:04', 'S248EF0000001', 'port7', 30],
  ['00:40:8c:cc:30:01', 'S248EF0000001', 'port8', 40],
  ['00:40:8c:cc:30:02', 'S248EF0000001', 'port9', 40],
  ['00:40:8c:cc:30:03', 'S124EN0000002', 'port2', 40],
  ['bc:ad:28:dd:30:04', 'S124EN0000002', 'port3', 99],
  ['a4:bb:6d:40:00:01', 'S248EF0000001', 'port10', 10],
  ['a4:bb:6d:40:00:02', 'S248EF0000001', 'port11', 10],
  ['54:bf:64:40:00:03', 'S248EF0000001', 'port12', 10],
  ['8c:16:45:40:00:04', 'S124EN0000002', 'port4', 10],
  ['8c:16:45:40:00:05', 'S124EN0000002', 'port5', 10],
  ['90:6c:ac:50:00:01', 'S248EF0000001', 'port13', 50],
  ['90:6c:ac:50:00:02', 'S124EN0000002', 'port11', 50],
  ['00:30:de:60:00:01', 'S124EN0000002', 'port6', 99],
  ['00:0c:29:70:00:01', 'S124EN0000002', 'port12', 10],
  ['b8:27:eb:80:00:01', 'S124EN0000002', 'port9', 10],
  ['4a:1c:88:99:aa:01', 'S124EN0000002', 'port7', 99],
  ['6e:32:11:5f:cd:02', 'S124EN0000002', 'port8', 99],
  ['f0:9f:c2:aa:bb:03', 'S248EF0000001', 'port14', 10],
  // Alle hinter dem Tischswitch an port14
  ['3c:52:82:90:00:01', 'S248EF0000001', 'port14', 10],
  ['3c:52:82:90:00:02', 'S248EF0000001', 'port14', 10],
  ['f4:d4:88:90:00:03', 'S248EF0000001', 'port14', 10],
  ['f4:d4:88:90:00:04', 'S248EF0000001', 'port14', 10],
  ['8c:16:45:90:00:05', 'S248EF0000001', 'port14', 10],
  ['00:e0:4c:90:00:06', 'S248EF0000001', 'port14', 10],
  ['54:2a:1b:90:00:07', 'S248EF0000001', 'port14', 10],
  ['b0:be:76:90:00:08', 'S248EF0000001', 'port14', 10],
  ['e4:5f:01:90:00:09', 'S248EF0000001', 'port14', 10],
];

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function ok(payload, extra = {}) {
  return {
    status: 200,
    ok: true,
    data: {
      http_method: 'GET',
      status: 'success',
      http_status: 200,
      vdom: 'root',
      serial: SERIAL,
      version: VERSION,
      build: BUILD,
      ...payload,
      ...extra,
    },
  };
}

function fail(httpStatus, error, cliError) {
  return {
    status: httpStatus,
    ok: false,
    data: {
      status: 'error',
      http_status: httpStatus,
      error,
      ...(cliError ? { cli_error: cliError } : {}),
      serial: SERIAL,
      version: VERSION,
      build: BUILD,
    },
  };
}

export function createDemoStore() {
  const db = {
    'switch-controller/dynamic-port-policy': clone(DYNAMIC_PORT_POLICIES),
    'switch-controller/vlan-policy': clone(VLAN_POLICIES),
    'switch-controller/lldp-profile': clone(LLDP_PROFILES),
    'switch-controller/switch-interface-tag': clone(INTERFACE_TAGS),
    'switch-controller.qos/qos-policy': clone(QOS_POLICIES),
    'switch-controller.security-policy/802-1X': clone(SEC_POLICIES),
    'switch-controller/managed-switch': clone(SWITCHES),
    'system/interface': clone(VLANS),
  };

  const bounced = [];

  /** Wertet die DPP-Regeln aus, damit matched-devices realistisch bleibt. */
  function evaluate() {
    const out = [];
    for (const [mac, switchId, portName] of PLACEMENT) {
      const sw = db['switch-controller/managed-switch'].find((s) => s['switch-id'] === switchId);
      const p = sw?.ports.find((x) => x['port-name'] === portName);
      if (!p || p['access-mode'] !== 'dynamic' || !p['port-policy']) continue;

      const dpp = db['switch-controller/dynamic-port-policy'].find((d) => d.name === p['port-policy']);
      if (!dpp) continue;

      const device = DEVICES.find((d) => d.mac === mac);
      if (!device) continue;

      const hit = (dpp.policy || []).find((r) => matches(r, device, p));
      if (!hit) continue;

      out.push({
        mac,
        last_known_switch: switchId,
        last_known_port: portName,
        matched_nac_policy: '',
        matched_dynamic_port_policy: dpp.name,
        mac_policy: '',
        matched_policy: hit.name,
        is_dynamic: true,
        is_nac: false,
      });
    }
    return out;
  }

  function matches(r, device, p) {
    if (r.status === 'disable') return false;
    if (r.category === 'interface-tag') {
      const want = (r['interface-tags'] || []).map((t) => t['tag-name']);
      if (!want.length) return false;
      const have = (p['interface-tags'] || []).map((t) => t['tag-name']);
      return want.every((t) => have.includes(t));
    }
    const crit = [
      [r.mac, device.mac],
      [r['hw-vendor'], device.hardware_vendor],
      [r.type, device.hardware_type],
      [r.family, device.hardware_family],
      [r.host, device.hostname],
    ].filter(([want]) => want);
    if (!crit.length) return true; // leere Regel greift auf alles (Catch-All)
    // FortiOS matcht Vendor/Type/Family als Praefix, MAC exakt.
    return crit.every(([want, have]) =>
      String(have || '')
        .toLowerCase()
        .startsWith(String(want).toLowerCase())
    );
  }

  function tableKey(apiPath) {
    // "cmdb/switch-controller/vlan-policy" -> "switch-controller/vlan-policy"
    // "cmdb/switch-controller.qos/qos-policy" -> "switch-controller.qos/qos-policy"
    const rest = apiPath.replace(/^cmdb\//, '');
    const parts = rest.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    return { key: `${parts[0]}/${parts[1]}`, mkey: parts[2] ? decodeURIComponent(parts[2]) : null, tail: parts.slice(3) };
  }

  function mkeyField(key) {
    if (key === 'switch-controller/managed-switch') return 'switch-id';
    if (key === 'system/interface') return 'name';
    return 'name';
  }

  async function call(apiPath, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    const path = String(apiPath).replace(/^\/+/, '');
    const query = opts.query || {};
    const body = opts.body;

    // --- Monitor ---------------------------------------------------------
    if (path === 'monitor/system/status') {
      return ok({
        results: { hostname: 'FGT-DEMO', model: 'FortiGate-101F', serial: SERIAL, version: VERSION },
        vdom_mode: 'no-vdom',
      });
    }

    if (path === 'monitor/user/device/query') {
      return ok({ results: clone(DEVICES) });
    }

    if (path === 'monitor/switch-controller/detected-device') {
      return ok({
        results: PLACEMENT.map(([mac, switchId, portName, vlanId], i) => ({
          mac,
          switch_id: switchId,
          port_name: portName,
          port_id: i + 1,
          vlan_id: vlanId,
          last_seen: 20 + i * 7,
          vdom: 'root',
        })),
      });
    }

    if (path === 'monitor/switch-controller/matched-devices') {
      const all = evaluate();
      const includeDynamic = query.include_dynamic === true || query.include_dynamic === 'true';
      const filtered = includeDynamic ? all : all.filter((d) => !d.is_dynamic);
      const byMac = query.mac ? filtered.filter((d) => d.mac === query.mac) : filtered;
      const bySwitch = query.mkey ? byMac.filter((d) => d.last_known_switch === query.mkey) : byMac;
      return ok({ results: bySwitch });
    }

    if (path === 'monitor/switch-controller/nac-device/stats') {
      const n = evaluate().length;
      return ok({ results: { vdom_count: n, total_count: n, max_limit: 1024 } });
    }

    if (path === 'monitor/switch-controller/known-nac-device-criteria-list') {
      return ok({
        results: [
          { name: 'Fortinet IP Phone', description: 'FortiFone desk phones', device: { hw_vendor: 'Fortinet', type: 'IP Phone', family: '', os: '', host: '' } },
          { name: 'FortiAP', description: 'Fortinet access points', device: { hw_vendor: 'Fortinet', type: 'Wireless AP', family: 'FortiAP', os: '', host: '' } },
          { name: 'Axis IP Camera', description: 'Axis network cameras', device: { hw_vendor: 'Axis Comm', type: 'IP Camera', family: '', os: '', host: '' } },
          { name: 'HP Printer', description: 'HP network printers', device: { hw_vendor: 'Hewlett Pack', type: 'Printer', family: '', os: '', host: '' } },
          { name: 'Windows workstation', description: 'Any Windows PC', device: { hw_vendor: '', type: 'Windows PC', family: '', os: 'Windows', host: '' } },
        ],
      });
    }

    // Feldnamen und Semantik folgen dem FortiOS-Monitor-Schema: "status" ist hier
    // der LINK-Zustand, nicht der administrative aus der CMDB.
    if (path === 'monitor/switch-controller/managed-switch/status') {
      const occupied = new Set(PLACEMENT.map(([, sw, p]) => `${sw}|${p}`));
      const results = db['switch-controller/managed-switch'].map((s) => ({
        serial: s.sn,
        'switch-id': s['switch-id'],
        fgt_peer_intf_name: 'fortilink',
        state: 'Authorized',
        status: 'Connected',
        os_version: 'S248EF-v7.6.3-build1059',
        connecting_from: 'port24',
        join_time: 'Mon Aug 11 06:12:44 2026',
        max_poe_budget: 370,
        ports: s.ports.map((p) => {
          const name = p['port-name'];
          const key = `${s['switch-id']}|${name}`;
          const isUplink = (p['interface-tags'] ?? []).some((t) => t['tag-name'] === 'uplink');
          const adminDown = p.status === 'down';
          // Link steht, wo ein Geraet haengt oder ein Uplink konfiguriert ist.
          const up = !adminDown && (occupied.has(key) || isUplink);
          const poeDraw = up && !isUplink ? Number((3 + (name.length % 5) * 1.7).toFixed(1)) : 0;
          return {
            interface: name,
            status: up ? 'up' : 'down',
            duplex: up ? 'full' : 'half',
            speed: up ? (isUplink ? 10000 : 1000) : 0,
            fortilink_port: isUplink,
            vlan: p.vlan,
            poe_capable: !isUplink,
            poe_status: p['poe-status'] === 'enable' && !isUplink ? 'enabled' : 'disabled',
            port_power: poeDraw,
            power_status: poeDraw > 0 ? 2 : 0,
            stp_status: up ? 'forwarding' : 'disabled',
            isl_peer_device_name: isUplink ? 'FGT-DEMO' : '',
            isl_peer_port_name: '',
            isl_peer_trunk_name: '',
            fgt_peer_device_name: isUplink ? 'FGT-DEMO' : '',
            mclag: false,
            mclag_icl: false,
            supported_port_speeds: ['10half', '100full', '1000full'],
          };
        }),
      }));
      const filtered = query.mkey ? results.filter((r) => r['switch-id'] === query.mkey) : results;
      return ok({ results: filtered });
    }

    if (path === 'monitor/switch-controller/managed-switch/bounce-port' && method === 'POST') {
      bounced.push({ ...body, at: Date.now() });
      return ok({ results: {}, http_method: 'POST' });
    }

    // --- CMDB ------------------------------------------------------------
    if (path.startsWith('cmdb/')) {
      const parsed = tableKey(path);
      if (!parsed || !db[parsed.key]) return fail(404, -3, `Unknown table: ${parsed?.key ?? path}`);

      const table = db[parsed.key];
      const idField = mkeyField(parsed.key);

      // Kindtabelle: cmdb/switch-controller/dynamic-port-policy/<dpp>/policy[/<rule>]
      if (parsed.tail.length) {
        const parent = table.find((e) => e[idField] === parsed.mkey);
        if (!parent) return fail(404, -3, `Object not found: ${parsed.mkey}`);
        const [childName, childKey] = parsed.tail;
        if (!Array.isArray(parent[childName])) return fail(404, -3, `Unknown child table: ${childName}`);
        return childOp(parent, childName, childKey ? decodeURIComponent(childKey) : null, method, body, query);
      }

      if (method === 'GET') {
        const rows = parsed.mkey ? table.filter((e) => e[idField] === parsed.mkey) : table;
        if (parsed.mkey && !rows.length) return fail(404, -3, `Object not found: ${parsed.mkey}`);
        return ok({ results: clone(rows), path: parsed.key.split('/')[0], name: parsed.key.split('/')[1] });
      }

      if (method === 'POST') {
        const name = body?.[idField];
        if (!name) return fail(400, -8, `Missing ${idField}`);
        if (table.some((e) => e[idField] === name)) return fail(500, -5, `Duplicate entry: ${name}`);
        const missing = requiredMissing(parsed.key, body);
        if (missing) return fail(424, -23, `Attribute "${missing}" is required`);
        table.push(clone(body));
        return ok({ http_method: 'POST', mkey: name, revision_changed: true });
      }

      if (method === 'PUT') {
        const i = table.findIndex((e) => e[idField] === parsed.mkey);
        if (i === -1) return fail(404, -3, `Object not found: ${parsed.mkey}`);
        table[i] = { ...table[i], ...clone(body) };
        return ok({ http_method: 'PUT', mkey: table[i][idField], revision_changed: true });
      }

      if (method === 'DELETE') {
        const i = table.findIndex((e) => e[idField] === parsed.mkey);
        if (i === -1) return fail(404, -3, `Object not found: ${parsed.mkey}`);
        const used = referencedBy(parsed.key, parsed.mkey);
        if (used) return fail(424, -23, `Object is still referenced by ${used}`);
        table.splice(i, 1);
        return ok({ http_method: 'DELETE', mkey: parsed.mkey, revision_changed: true });
      }
    }

    return fail(404, -3, `Demo FortiGate has no handler for ${method} ${path}`);
  }

  function childOp(parent, childName, childKey, method, body, query) {
    const list = parent[childName];
    const idField = childName === 'policy' ? 'name' : Object.keys(list[0] ?? { name: '' })[0] || 'name';

    if (method === 'GET') {
      const rows = childKey ? list.filter((e) => e[idField] === childKey) : list;
      if (childKey && !rows.length) return fail(404, -3, `Child not found: ${childKey}`);
      return ok({ results: clone(rows) });
    }

    if (method === 'POST') {
      const name = body?.[idField];
      if (!name) return fail(400, -8, `Missing ${idField}`);
      if (list.some((e) => e[idField] === name)) return fail(500, -5, `Duplicate entry: ${name}`);
      list.push(childName === 'policy' ? rule(body) : clone(body));
      return ok({ http_method: 'POST', mkey: name, revision_changed: true });
    }

    if (method === 'PUT') {
      const i = list.findIndex((e) => e[idField] === childKey);
      if (i === -1) return fail(404, -3, `Child not found: ${childKey}`);

      // Reihenfolge aendern: ?action=move&before=|after=
      if (query.action === 'move') {
        const ref = query.before || query.after;
        const j = list.findIndex((e) => e[idField] === ref);
        if (j === -1) return fail(424, -23, `Move reference not found: ${ref}`);
        const [moved] = list.splice(i, 1);
        const target = list.findIndex((e) => e[idField] === ref);
        list.splice(query.before ? target : target + 1, 0, moved);
        return ok({ http_method: 'PUT', mkey: childKey, revision_changed: true });
      }

      list[i] = { ...list[i], ...clone(body) };
      return ok({ http_method: 'PUT', mkey: list[i][idField], revision_changed: true });
    }

    if (method === 'DELETE') {
      const i = list.findIndex((e) => e[idField] === childKey);
      if (i === -1) return fail(404, -3, `Child not found: ${childKey}`);
      list.splice(i, 1);
      return ok({ http_method: 'DELETE', mkey: childKey, revision_changed: true });
    }

    return fail(405, -3, `Method not allowed on child table`);
  }

  /** Pflichtfelder, die FortiOS ebenfalls mit 424 quittiert. */
  function requiredMissing(key, body) {
    if (key === 'switch-controller/dynamic-port-policy' || key === 'switch-controller/vlan-policy') {
      if (!body?.fortilink) return 'fortilink';
    }
    return null;
  }

  /** Verhindert das Loeschen referenzierter Objekte – wie die echte FortiGate. */
  function referencedBy(key, name) {
    if (key === 'switch-controller/vlan-policy') {
      for (const dpp of db['switch-controller/dynamic-port-policy']) {
        const hit = (dpp.policy || []).find((r) => r['vlan-policy'] === name);
        if (hit) return `dynamic-port-policy ${dpp.name} / ${hit.name}`;
      }
    }
    if (key === 'switch-controller/dynamic-port-policy') {
      for (const sw of db['switch-controller/managed-switch']) {
        const hit = sw.ports.find((p) => p['port-policy'] === name);
        if (hit) return `managed-switch ${sw['switch-id']} / ${hit['port-name']}`;
      }
    }
    return null;
  }

  return {
    call,
    info: { hostname: 'FGT-DEMO', model: 'FortiGate-101F', serial: SERIAL, version: VERSION, build: BUILD, vdomMode: 'no-vdom' },
    get bounced() {
      return bounced;
    },
  };
}
