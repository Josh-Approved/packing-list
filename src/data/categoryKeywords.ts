/**
 * Localized keyword source of truth for category inference.
 *
 * `inferCategory` (categoryInference.ts) matches a freshly typed item name
 * against these substring keywords to guess a packing category. The matcher is
 * locale-aware: it tries the active in-app locale's keyword set first, then
 * falls back to English, so English input still categorizes in any language
 * mode and a user typing in their own language stops landing everything in
 * "Misc"/Other (Josh's bug: app in Spanish → "manzanas"/"jugo de naranja" →
 * Otros, and here "pasaporte"/"camiseta" → the wrong place).
 *
 * This module is PURE DATA — no imports — so the structural verifier
 * (`josh-approved-factory/scratch/verify-categorization.mjs`) can load it
 * directly with Node. It is the single source of truth: categoryInference.ts
 * imports `KEYWORDS_BY_LOCALE.en` instead of an inline English list.
 *
 * Rules for the lists:
 *   - Every locale uses the SAME category keys as the `Category` union in
 *     trip.ts (the stable internal English keys, never display-localized).
 *     'Misc' carries no keywords in any locale — it is the explicit user
 *     fallback, exactly as before.
 *   - Keywords are lowercase substrings. Prefer stems so plurals/inflections
 *     match for free (Spanish 'manzana' also matches 'manzanas'; 'camiseta'
 *     covers 'camisetas'). Multi-word entries ('cepillo de dientes') are fine.
 *   - The matcher pads the typed name with spaces and uses LONGEST-keyword-wins
 *     (categoryInference.ts), so a trailing space on a keyword (e.g. English
 *     'water ', 'kid ') enforces a word boundary. Keep that trick where it
 *     matters; for non-English a distinct stem is usually enough.
 *   - English is the per-key fallback, so non-English lists should carry the
 *     native vocabulary, not English words (loanwords genuinely used in the
 *     language are fine).
 */

export const KEYWORDS_BY_LOCALE: Record<string, Record<string, string[]>> = {
  // -------------------------------------------------------------------------
  // English — migrated verbatim out of categoryInference.ts. Source of truth +
  // the universal fallback applied under every other locale.
  // -------------------------------------------------------------------------
  en: {
    Documents: [
      'passport', 'visa', 'license', 'wallet', 'cash', 'currency', 'card',
      'ticket', 'boarding pass', 'insurance', 'reservation', 'itinerary',
      'id', 'documents', 'paperwork',
    ],
    Clothing: [
      'shirt', 'tshirt', 't-shirt', 'pants', 'trousers', 'jeans', 'dress',
      'skirt', 'jacket', 'coat', 'suit', 'sock', 'underwear', 'briefs',
      'boxer', 'bra', 'belt', 'tie', 'hat', 'beanie', 'glove', 'mitten',
      'scarf', 'sweater', 'jumper', 'hoodie', 'shorts', 'pajama', 'pyjama',
      'swim', 'swimsuit', 'sandal', 'shoe', 'boot', 'sneaker', 'trainer',
      'flip flop', 'flip-flop', 'slipper', 'thermal', 'fleece', 'parka',
      'vest', 'leggings', 'tights', 'blouse', 'cardigan', 'tank top',
      'pullover',
    ],
    Toiletries: [
      'toothbrush', 'toothpaste', 'soap', 'shampoo', 'conditioner', 'razor',
      'shave', 'deodorant', 'lotion', 'sunscreen', 'sunblock', 'moisturizer',
      'mascara', 'lipstick', 'makeup', 'comb', 'hairbrush', 'floss',
      'mouthwash', 'tampon', 'pad ', 'cotton', 'nail clipper', 'tweezer',
      'perfume', 'cologne', 'aftershave', 'wipes', 'tissue', 'lip balm',
      'chapstick', 'hand sanitizer', 'dental', 'feminine',
    ],
    Electronics: [
      'phone', 'iphone', 'laptop', 'macbook', 'tablet', 'ipad', 'kindle',
      'reader', 'charger', 'cable', 'usb', 'lightning', 'adapter', 'battery',
      'powerbank', 'power bank', 'headphones', 'earbuds', 'airpods', 'camera',
      'lens', 'tripod', 'speaker', 'mouse', 'keyboard', 'sd card',
      'memory card', 'plug', 'converter', 'gopro', 'drone', 'gimbal',
      'switch', 'console', 'controller',
    ],
    Gear: [
      'tent', 'sleeping bag', 'backpack', 'pack', 'daypack', 'water bottle',
      'bottle', 'thermos', 'cooler', 'flashlight', 'headlamp', 'lantern',
      'compass', 'map', 'first aid', 'multi-tool', 'multitool', 'knife',
      'rope', 'tarp', 'mat', 'pillow', 'towel', 'blanket', 'umbrella',
      'binoculars', 'rain jacket', 'poncho', 'pole', 'stove', 'cookware',
      'duffel', 'duffle', 'carry-on', 'carryon', 'suitcase', 'luggage',
      'bag', 'fanny pack',
    ],
    Accessories: [
      'sunglasses', 'glasses', 'jewelry', 'jewellery', 'necklace', 'earring',
      'ring', 'bracelet', 'watch', 'bandana', 'cufflink', 'tie clip', 'pin',
      'sun hat',
    ],
    Food: [
      'snack', 'snacks', 'protein bar', 'granola', 'gel', 'jerky', 'nuts',
      'fruit', 'water ', 'gatorade', 'electrolyte', 'coffee', 'tea',
      'instant ', 'oatmeal', 'trail mix',
    ],
    Kids: [
      'diaper', 'baby', 'pacifier', 'binky', 'formula', 'bib', 'onesie',
      'stroller', 'bassinet', 'car seat', 'monitor', 'sippy', 'stuffed',
      'kid ', 'child ', 'toddler',
    ],
    Misc: [], // intentionally empty — Misc is the explicit user fallback
  },

  // -------------------------------------------------------------------------
  // Español
  // -------------------------------------------------------------------------
  es: {
    Documents: [
      'pasaporte', 'visado', 'visa', 'licencia', 'carné', 'carnet', 'cartera',
      'billetera', 'efectivo', 'dinero', 'moneda', 'tarjeta', 'billete',
      'boleto', 'entrada', 'seguro', 'reserva', 'itinerario', 'dni',
      'identificación', 'documento', 'pasaje',
    ],
    Clothing: [
      'camisa', 'camiseta', 'playera', 'pantalón', 'pantalones', 'vaquero',
      'jeans', 'vestido', 'falda', 'chaqueta', 'abrigo', 'traje', 'calcetín',
      'calcetines', 'ropa interior', 'calzoncillo', 'braga', 'sujetador',
      'cinturón', 'corbata', 'gorra', 'gorro', 'guante', 'bufanda', 'suéter',
      'jersey', 'sudadera', 'pijama', 'bañador', 'traje de baño', 'sandalia',
      'zapato', 'zapatilla', 'bota', 'deportiva', 'pantufla', 'térmica',
      'forro polar', 'chaleco', 'leggins', 'mallas', 'blusa', 'rebeca',
    ],
    Toiletries: [
      'cepillo de dientes', 'pasta de dientes', 'dentífrico', 'jabón',
      'champú', 'acondicionador', 'maquinilla', 'afeitar', 'desodorante',
      'loción', 'crema solar', 'protector solar', 'hidratante',
      'máscara de pestañas', 'pintalabios', 'maquillaje', 'peine',
      'cepillo de pelo', 'hilo dental', 'enjuague bucal', 'tampón',
      'compresa', 'algodón', 'cortaúñas', 'pinzas', 'perfume', 'colonia',
      'toallitas', 'pañuelo', 'bálsamo labial', 'gel hidroalcohólico',
      'desinfectante de manos',
    ],
    Electronics: [
      'teléfono', 'móvil', 'celular', 'portátil', 'ordenador', 'tableta',
      'libro electrónico', 'cargador', 'cable', 'adaptador', 'batería',
      'batería externa', 'auriculares', 'cascos', 'audífonos', 'cámara',
      'objetivo', 'trípode', 'altavoz', 'ratón', 'teclado',
      'tarjeta de memoria', 'enchufe', 'convertidor', 'dron', 'mando',
      'consola',
    ],
    Gear: [
      'tienda de campaña', 'saco de dormir', 'mochila', 'esterilla',
      'botella de agua', 'cantimplora', 'termo', 'nevera', 'linterna',
      'frontal', 'farol', 'brújula', 'mapa', 'botiquín', 'navaja',
      'cuchillo', 'cuerda', 'lona', 'colchoneta', 'almohada', 'toalla',
      'manta', 'paraguas', 'prismáticos', 'chubasquero', 'poncho', 'bastón',
      'hornillo', 'maleta', 'equipaje', 'bolsa', 'riñonera',
    ],
    Accessories: [
      'gafas de sol', 'gafas', 'joya', 'joyería', 'collar', 'pendiente',
      'anillo', 'pulsera', 'reloj', 'pañuelo de cabeza', 'gemelos', 'broche',
      'sombrero',
    ],
    Food: [
      'aperitivo', 'tentempié', 'barrita', 'barra de proteína', 'granola',
      'gel energético', 'cecina', 'frutos secos', 'fruta', 'agua', 'café',
      'té', 'avena', 'mezcla de frutos secos', 'electrolitos',
      'bebida isotónica',
    ],
    Kids: [
      'pañal', 'bebé', 'chupete', 'fórmula infantil', 'babero', 'cochecito',
      'carrito', 'sillita de coche', 'vaso entrenamiento', 'peluche', 'niño',
      'niña', 'infantil', 'toallitas de bebé',
    ],
    Misc: [],
  },

  // -------------------------------------------------------------------------
  // Deutsch
  // -------------------------------------------------------------------------
  de: {
    Documents: [
      'reisepass', 'pass', 'visum', 'führerschein', 'ausweis', 'geldbörse',
      'portemonnaie', 'brieftasche', 'bargeld', 'geld', 'währung', 'karte',
      'ticket', 'fahrkarte', 'eintrittskarte', 'bordkarte', 'versicherung',
      'reservierung', 'reiseplan', 'personalausweis', 'dokument',
      'unterlagen',
    ],
    Clothing: [
      'hemd', 'oberteil', 'hose', 'jeans', 'kleid', 'rock', 'jacke',
      'mantel', 'anzug', 'socke', 'socken', 'unterwäsche', 'unterhose',
      'slip', 'büstenhalter', 'gürtel', 'krawatte', 'mütze', 'hut',
      'handschuh', 'schal', 'pullover', 'pulli', 'kapuzenpullover',
      'kurze hose', 'schlafanzug', 'pyjama', 'badeanzug', 'badehose',
      'sandale', 'schuh', 'stiefel', 'turnschuh', 'hausschuh', 'thermo',
      'fleecejacke', 'weste', 'strumpfhose', 'bluse', 'strickjacke',
    ],
    Toiletries: [
      'zahnbürste', 'zahnpasta', 'seife', 'spülung', 'rasierer', 'rasieren',
      'deodorant', 'sonnencreme', 'sonnenschutz', 'feuchtigkeitscreme',
      'wimperntusche', 'lippenstift', 'schminke', 'kamm', 'haarbürste',
      'zahnseide', 'mundwasser', 'tampon', 'binde', 'watte', 'nagelknipser',
      'pinzette', 'parfüm', 'rasierwasser', 'feuchttücher', 'taschentuch',
      'lippenbalsam', 'handdesinfektion',
    ],
    Electronics: [
      'telefon', 'handy', 'smartphone', 'laptop', 'tablet', 'e-reader',
      'ladegerät', 'ladekabel', 'kabel', 'adapter', 'batterie', 'akku',
      'powerbank', 'kopfhörer', 'ohrhörer', 'kamera', 'objektiv', 'stativ',
      'lautsprecher', 'maus', 'tastatur', 'speicherkarte', 'stecker',
      'drohne', 'controller', 'konsole',
    ],
    Gear: [
      'zelt', 'schlafsack', 'rucksack', 'isomatte', 'trinkflasche',
      'flasche', 'thermoskanne', 'kühlbox', 'taschenlampe', 'stirnlampe',
      'laterne', 'kompass', 'landkarte', 'erste hilfe', 'taschenmesser',
      'messer', 'seil', 'plane', 'unterlage', 'kissen', 'handtuch', 'decke',
      'regenschirm', 'fernglas', 'regenjacke', 'poncho', 'wanderstock',
      'kocher', 'koffer', 'gepäck', 'tasche', 'gürteltasche',
    ],
    Accessories: [
      'sonnenbrille', 'brille', 'schmuck', 'halskette', 'ohrring', 'ring',
      'armband', 'uhr', 'kopftuch', 'manschettenknöpfe', 'brosche',
      'sonnenhut',
    ],
    Food: [
      'imbiss', 'riegel', 'müsli', 'müsliriegel', 'energiegel',
      'trockenfleisch', 'nüsse', 'obst', 'frucht', 'wasser', 'kaffee', 'tee',
      'haferflocken', 'studentenfutter', 'elektrolyt',
    ],
    Kids: [
      'windel', 'baby', 'schnuller', 'säuglingsnahrung', 'lätzchen',
      'strampler', 'kinderwagen', 'babyschale', 'autositz', 'babyphone',
      'trinklernbecher', 'kuscheltier', 'kind', 'kleinkind', 'babytücher',
    ],
    Misc: [],
  },

  // -------------------------------------------------------------------------
  // Français
  // -------------------------------------------------------------------------
  fr: {
    Documents: [
      'passeport', 'visa', 'permis', 'permis de conduire', "carte d'identité",
      'portefeuille', 'espèces', 'argent', 'monnaie', 'devise', 'carte',
      'billet', 'ticket', "carte d'embarquement", 'assurance', 'réservation',
      'itinéraire', "pièce d'identité", 'document', 'papiers',
    ],
    Clothing: [
      'chemise', 't-shirt', 'tee-shirt', 'haut', 'pantalon', 'jean', 'robe',
      'jupe', 'veste', 'manteau', 'costume', 'chaussette', 'sous-vêtement',
      'slip', 'soutien-gorge', 'ceinture', 'cravate', 'bonnet', 'chapeau',
      'gant', 'écharpe', 'pull', 'sweat', 'sweat à capuche', 'pyjama',
      'maillot de bain', 'sandale', 'chaussure', 'botte', 'basket',
      'chausson', 'thermique', 'polaire', 'gilet', 'legging', 'collant',
      'chemisier', 'cardigan',
    ],
    Toiletries: [
      'brosse à dents', 'dentifrice', 'savon', 'shampoing', 'après-shampoing',
      'rasoir', 'raser', 'déodorant', 'crème solaire', 'écran solaire',
      'hydratant', 'mascara', 'rouge à lèvres', 'maquillage', 'peigne',
      'brosse à cheveux', 'fil dentaire', 'bain de bouche', 'tampon',
      'serviette hygiénique', 'coton', 'coupe-ongles', 'pince à épiler',
      'parfum', 'lingettes', 'mouchoir', 'baume à lèvres',
      'gel hydroalcoolique',
    ],
    Electronics: [
      'téléphone', 'portable', 'smartphone', 'ordinateur', 'tablette',
      'liseuse', 'chargeur', 'câble', 'adaptateur', 'batterie',
      'batterie externe', 'écouteurs', 'casque', 'caméra', 'appareil photo',
      'objectif', 'trépied', 'enceinte', 'souris', 'clavier', 'carte mémoire',
      'prise', 'drone', 'manette', 'console',
    ],
    Gear: [
      'tente', 'sac de couchage', 'sac à dos', 'matelas', 'gourde',
      "bouteille d'eau", 'thermos', 'glacière', 'lampe de poche',
      'lampe frontale', 'lanterne', 'boussole', 'carte', 'trousse de secours',
      'couteau', 'corde', 'bâche', 'tapis', 'oreiller', 'serviette',
      'couverture', 'parapluie', 'jumelles', 'veste de pluie', 'poncho',
      'bâton', 'réchaud', 'valise', 'bagage', 'sac', 'banane',
    ],
    Accessories: [
      'lunettes de soleil', 'lunettes', 'bijou', 'bijoux', 'collier',
      "boucle d'oreille", 'bague', 'bracelet', 'montre', 'foulard',
      'boutons de manchette', 'broche', 'chapeau de soleil',
    ],
    Food: [
      'en-cas', 'barre', 'barre protéinée', 'granola', 'gel énergétique',
      'viande séchée', 'noix', 'fruit', 'eau', 'café', 'thé',
      "flocons d'avoine", 'mélange de fruits secs',
    ],
    Kids: [
      'couche', 'bébé', 'tétine', 'lait infantile', 'bavoir', 'poussette',
      'siège auto', 'babyphone', 'gobelet', 'peluche', 'enfant', 'bambin',
      'lingettes bébé',
    ],
    Misc: [],
  },

  // -------------------------------------------------------------------------
  // Italiano
  // -------------------------------------------------------------------------
  it: {
    Documents: [
      'passaporto', 'visto', 'patente', "carta d'identità", 'portafoglio',
      'contanti', 'denaro', 'soldi', 'valuta', 'carta', 'biglietto',
      "carta d'imbarco", 'assicurazione', 'prenotazione', 'itinerario',
      'documento',
    ],
    Clothing: [
      'camicia', 'maglietta', 'maglia', 'pantaloni', 'jeans', 'vestito',
      'abito', 'gonna', 'giacca', 'cappotto', 'completo', 'calzino', 'calze',
      'biancheria intima', 'mutande', 'reggiseno', 'cintura', 'cravatta',
      'berretto', 'cappello', 'guanto', 'sciarpa', 'maglione', 'felpa',
      'pantaloncini', 'pigiama', 'costume da bagno', 'sandalo', 'scarpa',
      'stivale', 'scarpa da ginnastica', 'pantofola', 'termico', 'pile',
      'gilet', 'leggings', 'collant', 'camicetta', 'cardigan',
    ],
    Toiletries: [
      'spazzolino', 'dentifricio', 'sapone', 'shampoo', 'balsamo', 'rasoio',
      'radere', 'deodorante', 'crema solare', 'protezione solare',
      'idratante', 'mascara', 'rossetto', 'trucco', 'pettine', 'spazzola',
      'filo interdentale', 'collutorio', 'tampone', 'assorbente', 'cotone',
      'tagliaunghie', 'pinzetta', 'profumo', 'salviette', 'fazzoletto',
      'balsamo per labbra', 'disinfettante per mani',
    ],
    Electronics: [
      'telefono', 'cellulare', 'smartphone', 'computer portatile', 'tablet',
      'e-reader', 'caricabatterie', 'cavo', 'adattatore', 'batteria',
      'power bank', 'cuffie', 'auricolari', 'fotocamera', 'obiettivo',
      'treppiede', 'altoparlante', 'mouse', 'tastiera', 'scheda di memoria',
      'presa', 'drone', 'controller', 'console',
    ],
    Gear: [
      'tenda', 'sacco a pelo', 'zaino', 'materassino', 'borraccia',
      "bottiglia d'acqua", 'thermos', 'borsa frigo', 'torcia',
      'lampada frontale', 'lanterna', 'bussola', 'mappa',
      'kit di pronto soccorso', 'coltello', 'corda', 'telo', 'stuoia',
      'cuscino', 'asciugamano', 'coperta', 'ombrello', 'binocolo',
      'giacca antipioggia', 'poncho', 'bastone', 'fornello', 'valigia',
      'bagaglio', 'borsa', 'marsupio',
    ],
    Accessories: [
      'occhiali da sole', 'occhiali', 'gioiello', 'gioielli', 'collana',
      'orecchino', 'anello', 'braccialetto', 'orologio', 'bandana', 'gemelli',
      'spilla', 'cappello da sole',
    ],
    Food: [
      'spuntino', 'barretta', 'granola', 'gel energetico', 'carne secca',
      'noci', 'frutta', 'acqua', 'caffè', 'tè', "fiocchi d'avena",
      'frutta secca',
    ],
    Kids: [
      'pannolino', 'neonato', 'ciuccio', 'latte in polvere', 'bavaglino',
      'passeggino', 'seggiolino auto', 'baby monitor', 'tazza', 'peluche',
      'bambino', 'salviette per bambini',
    ],
    Misc: [],
  },

  // -------------------------------------------------------------------------
  // Português (Brasil)
  // -------------------------------------------------------------------------
  'pt-BR': {
    Documents: [
      'passaporte', 'visto', 'carteira de motorista', 'habilitação',
      'identidade', 'carteira', 'dinheiro', 'moeda', 'cartão', 'bilhete',
      'passagem', 'ingresso', 'cartão de embarque', 'seguro', 'reserva',
      'itinerário', 'documento',
    ],
    Clothing: [
      'camisa', 'camiseta', 'blusa', 'calça', 'jeans', 'vestido', 'saia',
      'jaqueta', 'casaco', 'terno', 'meia', 'roupa íntima', 'cueca',
      'calcinha', 'sutiã', 'cinto', 'gravata', 'boné', 'chapéu', 'luva',
      'cachecol', 'suéter', 'blusão', 'moletom', 'pijama', 'traje de banho',
      'maiô', 'sunga', 'sandália', 'sapato', 'bota', 'tênis', 'chinelo',
      'térmica', 'colete', 'legging', 'meia-calça', 'cardigã',
    ],
    Toiletries: [
      'escova de dentes', 'pasta de dente', 'creme dental', 'sabonete',
      'shampoo', 'xampu', 'condicionador', 'barbeador', 'barbear',
      'desodorante', 'protetor solar', 'hidratante', 'rímel', 'batom',
      'maquiagem', 'pente', 'escova de cabelo', 'fio dental',
      'enxaguante bucal', 'absorvente', 'algodão', 'cortador de unha',
      'pinça', 'perfume', 'lenços umedecidos', 'lenço', 'manteiga labial',
      'álcool em gel',
    ],
    Electronics: [
      'telefone', 'celular', 'smartphone', 'notebook', 'tablet',
      'leitor digital', 'carregador', 'cabo', 'adaptador', 'bateria',
      'bateria portátil', 'fones de ouvido', 'fone', 'câmera', 'lente',
      'tripé', 'caixa de som', 'mouse', 'teclado', 'cartão de memória',
      'tomada', 'drone', 'controle', 'console',
    ],
    Gear: [
      'barraca', 'saco de dormir', 'mochila', 'isolante', 'garrafa de água',
      'garrafa térmica', 'cooler', 'lanterna', 'lanterna de cabeça',
      'lampião', 'bússola', 'mapa', 'kit de primeiros socorros', 'canivete',
      'faca', 'corda', 'lona', 'colchonete', 'travesseiro', 'toalha',
      'cobertor', 'guarda-chuva', 'binóculo', 'capa de chuva', 'poncho',
      'bastão', 'fogareiro', 'mala', 'bagagem', 'bolsa', 'pochete',
    ],
    Accessories: [
      'óculos de sol', 'óculos', 'joia', 'colar', 'brinco', 'anel',
      'pulseira', 'relógio', 'bandana', 'abotoaduras', 'broche',
      'chapéu de sol',
    ],
    Food: [
      'petisco', 'lanche', 'barra', 'barra de proteína', 'granola',
      'gel energético', 'carne seca', 'castanhas', 'fruta', 'água', 'café',
      'chá', 'aveia', 'mix de castanhas',
    ],
    Kids: [
      'fralda', 'bebê', 'chupeta', 'fórmula infantil', 'babador',
      'carrinho', 'bebê conforto', 'cadeirinha', 'babá eletrônica', 'copo',
      'bichinho de pelúcia', 'criança', 'lenços para bebê',
    ],
    Misc: [],
  },

  // -------------------------------------------------------------------------
  // 日本語 — no spaces; substring matching works directly on each term.
  // -------------------------------------------------------------------------
  ja: {
    Documents: [
      'パスポート', 'ビザ', '免許証', '運転免許証', '身分証', '財布', '現金',
      'お金', '通貨', 'カード', 'チケット', '切符', '搭乗券', '保険', '予約',
      '旅程', '書類',
    ],
    Clothing: [
      'シャツ', 'tシャツ', 'ズボン', 'パンツ', 'ジーンズ', 'ワンピース',
      'ドレス', 'スカート', 'ジャケット', 'コート', 'スーツ', '靴下', '下着',
      'ブラ', 'ベルト', 'ネクタイ', '帽子', '手袋', 'マフラー', 'セーター',
      'パーカー', 'ショートパンツ', 'パジャマ', '水着', 'サンダル', '靴',
      'ブーツ', 'スニーカー', 'スリッパ', '防寒', 'フリース', 'ベスト',
      'レギンス', 'タイツ', 'ブラウス', 'カーディガン',
    ],
    Toiletries: [
      '歯ブラシ', '歯磨き粉', '石鹸', 'シャンプー', 'コンディショナー',
      'リンス', '髭剃り', 'ひげそり', 'カミソリ', 'デオドラント',
      'ローション', '日焼け止め', '化粧水', '保湿', 'マスカラ', '口紅',
      '化粧品', 'くし', 'ヘアブラシ', 'デンタルフロス', 'マウスウォッシュ',
      'タンポン', '生理用品', '綿棒', '爪切り', 'ピンセット', '香水',
      'ウェットティッシュ', 'ティッシュ', 'リップクリーム', '手指消毒',
    ],
    Electronics: [
      '電話', '携帯', 'スマホ', 'スマートフォン', 'ノートパソコン',
      'パソコン', 'タブレット', '電子書籍', '充電器', 'ケーブル',
      'アダプター', '電池', 'バッテリー', 'モバイルバッテリー', 'ヘッドホン',
      'イヤホン', 'カメラ', 'レンズ', '三脚', 'スピーカー', 'マウス',
      'キーボード', 'メモリーカード', 'プラグ', 'ドローン', 'コントローラー',
      'ゲーム機',
    ],
    Gear: [
      'テント', '寝袋', 'リュック', 'バックパック', 'マット', '水筒',
      'ボトル', '魔法瓶', 'クーラーボックス', '懐中電灯', 'ヘッドランプ',
      'ランタン', 'コンパス', '地図', '救急セット', 'ナイフ', 'ロープ',
      'タープ', '枕', 'タオル', '毛布', '傘', '双眼鏡', 'レインジャケット',
      'ポンチョ', 'トレッキングポール', 'コンロ', 'スーツケース', '荷物',
      'バッグ', 'ウエストポーチ',
    ],
    Accessories: [
      'サングラス', '眼鏡', 'めがね', 'ジュエリー', 'アクセサリー',
      'ネックレス', 'イヤリング', '指輪', 'ブレスレット', '腕時計',
      'バンダナ', 'カフス', 'ブローチ', '日よけ帽子',
    ],
    Food: [
      'スナック', 'おやつ', 'バー', 'プロテインバー', 'グラノーラ', 'ゼリー',
      'ジャーキー', 'ナッツ', '果物', 'フルーツ', '水', 'コーヒー', 'お茶',
      'オートミール', 'ミックスナッツ',
    ],
    Kids: [
      'おむつ', 'オムツ', '赤ちゃん', 'おしゃぶり', '粉ミルク', 'よだれかけ',
      'ベビー服', 'ベビーカー', 'チャイルドシート', 'ベビーモニター',
      'ストローカップ', 'ぬいぐるみ', '子供', '子ども', 'おしりふき',
    ],
    Misc: [],
  },
};
