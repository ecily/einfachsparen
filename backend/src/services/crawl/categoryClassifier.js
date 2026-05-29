const { normalizeTitleForMatch, sanitizeWhitespace } = require('./sourceEvidence');

const CATEGORY_TAXONOMY = [
  {
    main: 'Lebensmittel',
    patterns: [/(lebensmittel|essen|nahrung|bio|genuss|feinkost|frisch|vegetarisch|vegan|backshop|kuehlregal|kuhlregal)/],
    subcategories: [
      { label: 'Obst & Gemuese', patterns: [/(obst|gemuse|gemuese|salat|kartoffel|erdapfel|erdapfel|zwiebel|tomate|paradeiser|gurke|paprika|karotte|mohre|moehre|radieschen|apfel|birne|banane|orange|mandarine|zitrone|beere|erdbeere|heidelbeere|traube|avocado|zucchini|kuerbis|kurbis|champignon|pilz|mango|mangos|nektarine|nektarinen|kresse)/] },
      { label: 'Brot & Gebaeck', patterns: [/(brot|gebaeck|geback|backwaren|semmel|weckerl|croissant|toast|baguette|kornspitz|weizenweckerl|striezel|brioche|tortilla|wrap)/] },
      { label: 'Fleisch, Wurst & Fisch', patterns: [/(fleisch|wurst|schinken|salami|speck|fisch|lachs|thunfisch|geflugel|gefluegel|huhn|hendl|pute|truthahn|rind|schwein|faschiert|hackfleisch|leberkaese|leberkase|bratwurst|frankfurter|kaesekrainer|kasekrainer|surimi|garnelen|shrimp)/] },
      { label: 'Milchprodukte', patterns: [/\b(milch|heumilch|vollmilch|buttermilch|butter|teebutter|joghurt|jogurt|topfen|sahne|rahm|quark|skyr|kefir|sauerrahm|schlagobers|obers|pudding|dessertcreme|milchreis)\b/] },
      { label: 'Kaese', patterns: [/\b(kase|kaese|grosslochkaese|grosslochkase|mozzarella|emmentaler|gouda|camembert|parmesan|bergkaese|bergkase|frischkaese|frischkase|schnittkaese|schnittkase|weinkaese|weinkase|oesterkron|osterkron|feta|ricotta|mascarpone|grana|cheddar|brie)\b/] },
      { label: 'Tiefkuehl- & Fertigprodukte', patterns: [/\b(tiefkuhl|tiefkuehl|pizza|fertig|mikrowelle|tk|frost|lasagne|pommes|eis|eiscreme|fischstaebchen|fischstabchen|fertiggericht|convenience|tiefgekuhlt|tiefgekuehlt)\b/] },
      { label: 'Suesswaren & Knabbereien', patterns: [/\b(schokolade|susswaren|suesswaren|fruchtgummi|gummibaer|gummibaeren|knabberei|chips|flips|brotchips|kekse|butterkeks|bonbon|zuckerl|praline|pralinen|nougat|snack|nusse|nuesse|erdnuss|erdnusse|erdnuesse|mandel|cashew|waffel|popcorn|soletti|cracker|riegel|muesliriegel|muesli riegel|proteinriegel)\b/] },
      { label: 'Pasta, Reis & Konserven', patterns: [/\b(nudel|nudeln|pasta|spaghetti|fusilli|penne|reis|risotto|konserve|bohnen|linsen|kichererbse|passata|polpa|sugo|dosentomaten|mais|erbsen|thunfischdose|ravioli|gnocchi|couscous|bulgur)\b/] },
      { label: 'Saucen, Oele & Gewuerze', patterns: [/\b(sauce|saucen|bouillon|suppe|suppen|bruehe|bruhe|oel|olivenoel|rapsoel|sonnenblumenoel|kronenoel|gewurz|gewuerz|gewuerze|krauter|kraeuter|essig|ketchup|mayonnaise|mayo|senf|pesto)\b/] },
      { label: 'Backen & Grundnahrungsmittel', patterns: [/\b(mehl|zucker|staubzucker|kristallzucker|backzucker|backpulver|vanillezucker|hefe|germ|staerke|starke|paniermehl|eier|ei|freilandeier|bodenhaltung|salz|gries|griess|haferflocken)\b/] },
      { label: 'Fruehstueck & Aufstriche', patterns: [/(marmelade|konfituere|konfiture|honig|musli|muesli|cornflakes|cerealien|porridge|aufstrich|nougatcreme|brotaufstrich|erdnussbutter)/] },
    ],
  },
  {
    main: 'Getraenke',
    patterns: [/(getrank|getraenk|trinken|durst|pfandflasche|mehrweg|einweg)/],
    subcategories: [
      { label: 'Wasser', patterns: [/(wasser|mineralwasser|sprudel)/] },
      { label: 'Softdrinks & Energy', patterns: [/\b(cola|limonade|limo|softdrink|energy|energydrink|eistee|isodrink|fanta|sprite|mezzo|almdudler|red bull|tonic|bitter lemon|drink)\b/] },
      { label: 'Saefte & Sirupe', patterns: [/\b(saft|nektar|sirup|smoothie|orangensaft|apfelsaft|multivitamin)\b/] },
      { label: 'Bier', patterns: [/\b(bier|pils|weizen|radler|lager|helles|maerzen|marzen|flaschenbier|dosenbier|ottakringer|puntigamer|hirter|schwechater|wieselburger|goesser|gosser|stiegl|zipfer|zwettler|kozel)\b/] },
      { label: 'Wein & Sekt', patterns: [/\b(wein|rotwein|weisswein|rosewein|rose|sekt|prosecco|champagner|frizzante|zweigelt|chardonnay|traminer|riesling|gruener veltliner|veltliner|hugo)\b/] },
      { label: 'Spirituosen', patterns: [/\b(whisky|whiskey|rum|gin|vodka|likor|likoer|spirituose|spirituosen|schnaps|johnnie walker|glenfiddich|jaegermeister|jagermeister)\b/] },
      { label: 'Kaffee & Tee', patterns: [/(kaffee|espresso|cappuccino|matcha|bohne|kaffeekapsel|kapseln|nespresso|dolce gusto|\btee\b|teebeutel|teekanne|eistee|kraeutertee|krautertee|schwarztee|gruentee|gruenentee|gruntee|fruechtetee|fruchtetee|kamillentee|pfefferminztee)/] },
      { label: 'Milchgetraenke', patterns: [/(kakao|milchdrink|milchgetrank|milchgetraenk|joghurtdrink|proteindrink|eiskaffee)/] },
    ],
  },
  {
    main: 'Drogerie / Hygiene',
    patterns: [/(drogerie|hygiene|pflege|kosmetik|beauty)/],
    subcategories: [
      { label: 'Haarpflege', patterns: [/(shampoo|spulung|spuelung|haar|haarkur|styling)/] },
      { label: 'Koerperpflege', patterns: [/(dusch|deo|deodorant|bodylotion|seife|creme|pflege|lotion|balsam|handcreme|sonnencreme|sonnenschutz|gesichtscreme|duschgel)/] },
      { label: 'Mund- & Zahnpflege', patterns: [/(zahnpasta|zahnburste|zahnbuerste|mundspulung|mundspuelung|zahn)/] },
      { label: 'Rasur', patterns: [/(rasierer|rasur|klinge|aftershave)/] },
      { label: 'Kosmetik & Make-up', patterns: [/(kosmetik|make up|makeup|mascara|lippenstift|foundation|parfum)/] },
      { label: 'Damenhygiene', patterns: [/(binden|tampon|slipeinlage|einlagen|damenhygiene)/] },
      { label: 'Babyhygiene', patterns: [/(windel|windeln|feuchttucher|feuchttuecher|babycreme|babyshampoo|pampers|babytuch)/] },
      { label: 'Haushaltspapier', patterns: [/(toilettenpapier|kuchenrolle|kuechenrolle|taschentucher|taschentuecher|haushaltspapier)/] },
      { label: 'Gesundheit & Nahrungsergaenzung', patterns: [/(vitamin|magnesium|omega|zink|nahrungserganzung|nahrungsergaenzung|kapsel|kapseln|tablette|tabletten|pastille|pastillen|supplement|pflaster|verband|kontaktlinsen|linsenloesung|linsenlosung|elektrolyt|dragee|dragees|melatonin|schwangerschaftstest|medizinprodukt|creatine|kreatin)/] },
    ],
  },
  {
    main: 'Haushalt',
    patterns: [/(haushalt|wohnen|reinigen|putzen)/],
    subcategories: [
      { label: 'Waschmittel & Reiniger', patterns: [/(waschmittel|weichspuler|weichspueler|reiniger|putzmittel|spulmittel|spuelmittel|entkalker|geschirrspul|spueltabs|spultabs|spuelmaschinentabs|spulmaschinentabs|waschcaps|tabs|vollwaschmittel|colorwaschmittel|wc reiniger|badreiniger|glasreiniger|allzweckreiniger|maschinenreiniger|duftspueler|duftspuler)/] },
      { label: 'Kuechenhelfer', patterns: [/(geschirr|pfanne|topf|besteck|messer|kochen|kueche|kuche)/] },
      { label: 'Aufbewahrung & Folien', patterns: [/(folie|frischhalte|alu|beutel|aufbewahrung|dose|box)/] },
      { label: 'Deko & Wohnen', patterns: [/(deko|kerze|vase|kissen|wohnen)/] },
      { label: 'Frotteewaren', patterns: [/(frottee|frotteewaren|handtuch|handtuecher|handtucher|strandtuch|strandtuecher|strandtucher|badematte|badematten|badetuch|badetuecher|badetucher)/] },
      { label: 'Lufterfrischer & Raumduft', patterns: [/(lufterfrischer|raumduft|duftspray|duftstecker|nachfuller|nachfueller|glade|airwick|air wick)/] },
      { label: 'Papier & Buero', patterns: [/(papier|buero|buro|ordner|heft|stift|druckerpapier)/] },
      { label: 'Papierwaren', patterns: [/(toilettenpapier|kuechenrolle|kuchenrolle|serviette|taschentuecher|taschentucher)/] },
    ],
  },
  {
    main: 'Non-Food',
    patterns: [/(non food|non-food|nichtlebensmittel|aktionsware|warenwelt)/],
    subcategories: [
      { label: 'Online-only / Sale', patterns: [/(online only|online-only|onlineangebot|online angebot|abverkauf|ausverkauf|clearance)/] },
      { label: 'Dauerpreise', patterns: [/(dauerpreis|dauer guenstig|dauer guenstiger|dauer-guenstig|immerguenstig|immer guenstig)/] },
      { label: 'Saisonen', patterns: [/(saison|saisonen|weihnachten|ostern|sommer|winter|schulstart|fasching)/] },
    ],
  },
  {
    main: 'Buero / Schule',
    patterns: [/(buero|buro|schule|schreibwaren|ordnen|etikett|drucker|scanner|papierwaren|kreativ|basteln)/],
    subcategories: [
      { label: 'Schreibwaren', patterns: [/(schreibwaren|stift|kugelschreiber|filzstift|marker|textmarker|bleistift|fineliner|heft|collegeblock|notizbuch|radierer|spitzer)/] },
      { label: 'Papier & Ordnen', patterns: [/(papier|briefkorb|stehsammler|ordner|register|mappe|formular|geschaftsbuch|geschaeftsbuch|etikett|fotopapier|kuvert)/] },
      { label: 'Drucker & Scanner', patterns: [/(drucker|scanner|toner|tinte|patrone|speichermedien|speicherkarte|festplatte|usb|pc zubehor|pc zubehoer|computerzubehor|computerzubehoer)/] },
      { label: 'Schule & Lernen', patterns: [/(schule|schultasche|rucksack|federschachtel|lineal|zirkel|geodreieck|lernen)/] },
      { label: 'Basteln & Kreativ', patterns: [/(basteln|kreativ|farben|pinsel|kleber|schere|buntpapier|malblock|knete|glitzer|sticker|party)/] },
    ],
  },
  {
    main: 'Tierbedarf',
    patterns: [/(tier|haustier|hund|katze|tierbedarf)/],
    subcategories: [
      { label: 'Tiernahrung', patterns: [/(tiernahrung|tierfutter|haustierfutter|nassfutter|trockenfutter|tiersnack|hundesnack|katzensnack|leckerli)/] },
      { label: 'Hundefutter', patterns: [/(hund|hundefutter|hundesnack)/] },
      { label: 'Katzenfutter', patterns: [/(katze|katzenfutter|katzensnack|perfect fit|gourmet perle)/] },
      { label: 'Katzenstreu & Pflege', patterns: [/(katzenstreu|katzenpflege)/] },
      { label: 'Tierzubehoer', patterns: [/(napf|leine|spielzeug|tierzubehor|tierzubehoer|kratzbaum|halsband|streu)/] },
    ],
  },
  {
    main: 'Garten / Pflanzen',
    patterns: [/(garten|pflanze|blume)/],
    subcategories: [
      { label: 'Pflanzen & Blumen', patterns: [/(pflanze|blume|orchidee|rose|topfpflanze)/] },
      { label: 'Erde & Duenger', patterns: [/(erde|kompost|dunger|duenger|hochbeeterde|blumenerde)/] },
      { label: 'Gartenzubehoer', patterns: [/(gartenzubehor|gartenzubehoer|schlauch|topf|saatsamen|samen|hochbeet|beet|gartenhaus)/] },
    ],
  },
  {
    main: 'Kleidung / Mode',
    patterns: [/(bekleidung|mode|kleidung)/],
    subcategories: [
      { label: 'Damenbekleidung', patterns: [/(damen|leggings|kleid|bluse|bh)/] },
      { label: 'Herrenbekleidung', patterns: [/(herren|hemd|boxershorts|unterhemd)/] },
      { label: 'Kinderbekleidung', patterns: [/(kinder|babykleidung|strampler)/] },
      { label: 'Schuhe & Accessoires', patterns: [/(schuh|socke|guertel|gurtel|mütze|muetze|tasche)/] },
    ],
  },
  {
    main: 'Technik / Elektronik',
    patterns: [/(technik|elektronik|geraet|gerat)/],
    subcategories: [
      { label: 'Kuechengeraete', patterns: [/(mikrowelle|toaster|wasserkocher|kaffeemaschine|fritteuse|grill|kontaktgrill|standgrill|heissluftfritteuse|heisluftfritteuse)/] },
      { label: 'Unterhaltungselektronik', patterns: [/(tv|fernseher|lautsprecher|kopfhorer|kopfhoerer)/] },
      { label: 'Computer & Mobile', patterns: [/(notebook|laptop|tablet|smartphone|monitor|drucker|scanner|speichermedien|festplatte|usb|computerzubehor|computerzubehoer|pc zubehor|pc zubehoer)/] },
      { label: 'Handys & Router', patterns: [/(handy|handys|smartphone|router|sim karte|simkarte|wertkarte|mobilfunk|telefon)/] },
      { label: 'Gaming & Technik', patterns: [/(gaming|gamepad|controller|spielkonsole|nintendo switch|playstation|xbox|videospiel|headset)/] },
      { label: 'Werkzeug & Akkus', patterns: [/(werkzeug|bohrer|akkuschrauber|akku|maschine)/] },
    ],
  },
  {
    main: 'Freizeit / Sonstiges',
    patterns: [/(freizeit|hobby|camping|schule|spiel)/],
    subcategories: [
      { label: 'Spielzeug', patterns: [/(spielzeug|lego|puppe|pluesch|plueschtier|hot wheels|barbie|spiel)/] },
      { label: 'Games & Konsolen', patterns: [/(games|spielkonsole|nintendo switch|playstation|xbox|videospiel)/] },
      { label: 'Schreibwaren & Schule', patterns: [/(schule|schreibwaren|heft|stift|malblock)/] },
      { label: 'Party & Schenken', patterns: [/(party|geschenk|schenken|ballon|serviette|geschenkpapier|geschenktasche|geburtstag|feier)/] },
      { label: 'Saisonen', patterns: [/(saison|saisonen|weihnachten|ostern|sommer|winter|schulstart|fasching)/] },
      { label: 'Sport & Camping', patterns: [/(sport|camping|fahrrad|helm|outdoor|grill|freizeit)/] },
      { label: 'Autozubehoer', patterns: [/(autozubehor|autozubehoer|motoroel|reifen)/] },
    ],
  },
  {
    main: 'Baby / Kinder',
    patterns: [/(baby|kinder|kind)/],
    subcategories: [
      { label: 'Babybedarf', patterns: [/(baby|schnuller|strampler|babyflasche)/] },
      { label: 'Kinderpflege', patterns: [/(kinderpflege|babyshampoo|babycreme|windel)/] },
    ],
  },
];

const HARD_CATEGORY_OVERRIDES = [
  {
    patterns: [/\bfelix\b.*(linsen|bohnen|eintopf|konserve|ravioli|sugo|pasta|chili|gulasch)/],
    main: 'Lebensmittel',
    sub: 'Pasta, Reis & Konserven',
  },
  {
    patterns: [/\b(somat|geschirrspueltabs|geschirrspultabs|geschirrspuel-tabs|geschirrspul-tabs|spuelmaschinentabs|spulmaschinentabs)\b/],
    main: 'Haushalt',
    sub: 'Waschmittel & Reiniger',
  },
  {
    patterns: [/\b(sojasauce|pizzasauce|bratolivenoel)\b/],
    main: 'Lebensmittel',
    sub: 'Saucen, Oele & Gewuerze',
  },
  {
    patterns: [/\b(body butter|koerperbutter|korperbutter|lippenbalsam|lippenpflege|lip butter|lippen butter)\b/],
    main: 'Drogerie / Hygiene',
    sub: 'Koerperpflege',
  },
  {
    patterns: [/\bteebutter\b/],
    main: 'Lebensmittel',
    sub: 'Milchprodukte',
  },
  {
    patterns: [/\bsommerbutter\b/],
    main: 'Lebensmittel',
    sub: 'Milchprodukte',
  },
  {
    patterns: [/\b(pedigree|schmackos|biscrok)\b/],
    main: 'Tierbedarf',
    sub: 'Hundefutter',
  },
  {
    patterns: [
      /\b(felix|whiskas|gourmet gold|gourmet perle|purina one|sheba|zooroyal)\b.*\b(katze|katzen|katzenfutter|katzennahrung|nassfutter|trockenfutter|futter|dose|schale|beutel)\b/,
      /\b(katze|katzen|katzenfutter|katzennahrung|nassfutter|trockenfutter|futter)\b.*\b(felix|whiskas|gourmet gold|gourmet perle|purina one|sheba|zooroyal)\b/,
      /\bpurina\b.*\bfelix\b|\bfelix\b.*\bpurina\b/,
    ],
    main: 'Tierbedarf',
    sub: 'Katzenfutter',
  },
  {
    patterns: [/\b(klumpstreu|katzenstreu|ultra klumpstreu)\b/],
    main: 'Tierbedarf',
    sub: 'Katzenstreu & Pflege',
  },
  {
    patterns: [/\b(eau de parfum|eau de toilette|parfum|fragrance|fragrances|duft)\b/],
    main: 'Drogerie / Hygiene',
    sub: 'Kosmetik & Make-up',
  },
  {
    patterns: [/\b(duftset|parfumset|eau de parfum set|eau de toilette set)\b/],
    main: 'Drogerie / Hygiene',
    sub: 'Kosmetik & Make-up',
  },
  {
    patterns: [
      /\bgeschenkset\b.*\b(eau de|parfum|duft|fragrance|herrenduft|damenduft|pour homme|pour femme|homme|femme)\b/,
      /\b(eau de|parfum|duft|fragrance|herrenduft|damenduft|pour homme|pour femme|homme|femme)\b.*\bgeschenkset\b/,
      /(?=.*\bgeschenkset\b)(?=.*\bbottled\b)(?=.*\b(hugo boss|hugo|boss|parfum|duft|fragrance|eau de)\b)/,
    ],
    main: 'Drogerie / Hygiene',
    sub: 'Kosmetik & Make-up',
  },
  {
    patterns: [/\b(oral-b|oral b|zahnpasta|zahnburste|zahnbuerste|elektrische zahnburste|elektrische zahnbuerste|zahnseide|aufsteckbursten|aufsteckbuersten|mundpflege|mundspulung|mundspuelung)\b/],
    main: 'Drogerie / Hygiene',
    sub: 'Mund- & Zahnpflege',
  },
  {
    patterns: [/\b(sonnencreme|sonnenmilch|sonnenspray|sonnenfluid|sonnenstick|sonnenschutz|after sun|sun spray|sunscreen|spf\s*\d{1,3}\+?|lsf\s*\d{1,3}\+?)\b/],
    main: 'Drogerie / Hygiene',
    sub: 'Koerperpflege',
  },
  {
    patterns: [/\b(blue star|wc[-\s]?reiniger|wc[-\s]?steine|wc[-\s]?kraft[-\s]?tabs|spuelkastenwuerfel|spulkastenwurfel|spuelkastenwurfel|spulkastenwuerfel|badreiniger|power reiniger)\b/],
    main: 'Haushalt',
    sub: 'Waschmittel & Reiniger',
  },
  {
    patterns: [/\b(frottee|frotteewaren|handtuch|handtuecher|handtucher|strandtuch|strandtuecher|strandtucher|badematte|badematten|badetuch|badetuecher|badetucher)\b/],
    main: 'Haushalt',
    sub: 'Frotteewaren',
  },
  {
    patterns: [/\b(handy|handys|smartphone|router|simkarte|sim karte|wertkarte|mobilfunk)\b/],
    main: 'Technik / Elektronik',
    sub: 'Handys & Router',
  },
  {
    patterns: [/\b(gaming|gamepad|controller|spielkonsole|nintendo switch|playstation|xbox|videospiel|headset)\b/],
    main: 'Technik / Elektronik',
    sub: 'Gaming & Technik',
  },
  {
    patterns: [/\b(party|geschenk|schenken|ballon|geschenkpapier|geschenktasche|geburtstag|partydeko)\b/],
    main: 'Freizeit / Sonstiges',
    sub: 'Party & Schenken',
  },
  {
    patterns: [/\b(non food|non-food|nichtlebensmittel|aktionsware)\b/],
    main: 'Non-Food',
    sub: 'Sonstiges',
  },
  {
    patterns: [/\b(roestgemuese|rostgemuese|buttergemuese|buttergemuse|gemuese reindl|gemuse reindl|gemuese a la creme|gemuse a la creme|iglo gemuese|iglo gemuse|cremespinat|blattspinat|rotkraut)\b/],
    main: 'Lebensmittel',
    sub: 'Tiefkuehl- & Fertigprodukte',
  },
  {
    patterns: [/\b(fischstaebchen|fischstabchen|ofenbackfisch|backfisch|filegro|polar dorsch|polardorsch|kabeljau|wildlachs|fisch n roesti|fisch n rosti)\b/],
    main: 'Lebensmittel',
    sub: 'Fleisch, Wurst & Fisch',
  },
  {
    patterns: [/\b(gasteiner|infinity water|mineralwasser|wasser|sprudel|voslauer|voeslauer|soda|sparkling)\b/],
    main: 'Getraenke',
    sub: 'Wasser',
  },
  {
    patterns: [/\b(tee|teebeutel|teekanne|eistee|kraeutertee|krautertee|schwarztee|gruentee|gruenentee|gruntee|fruechtetee|fruchtetee|kamillentee|pfefferminztee)\b/],
    main: 'Getraenke',
    sub: 'Kaffee & Tee',
  },
  {
    patterns: [/\b(schartner bombe|cola|kola|limonade|limo|softdrink|energy|energydrink|eistee|isodrink|isostar|powerade|fanta|sprite|mezzo|almdudler|red bull|tonic|bitter lemon|drink|superzero)\b/],
    main: 'Getraenke',
    sub: 'Softdrinks & Energy',
  },
  {
    patterns: [/\b(la gioiosa|spumante|rotwein|weisswein|rosewein|wein|sekt|prosecco|champagner|frizzante|zweigelt|chardonnay|traminer|riesling|welschriesling|veltliner|hugo|gluhwein|gluehwein|cuvee)\b/],
    main: 'Getraenke',
    sub: 'Wein & Sekt',
  },
  {
    patterns: [/\b(barilla|teigwaren|fusilli|spaghetti|penne|nudel|nudeln|pasta|bavette|maccheroni|ravioli|gnocchi|couscous|bulgur|risotto)\b/],
    main: 'Lebensmittel',
    sub: 'Pasta, Reis & Konserven',
  },
  {
    patterns: [/\b(reiswaffel|reiswaffeln|reischips)\b/],
    main: 'Lebensmittel',
    sub: 'Suesswaren & Knabbereien',
  },
  {
    patterns: [/\b(waschmittel|weichspuler|weichspueler|reiniger|cremereiniger|putzmittel|spulmittel|spuelmittel|entkalker|wc reiniger|badreiniger|glasreiniger|allzweckreiniger|duftspueler|duftspuler)\b/],
    main: 'Haushalt',
    sub: 'Waschmittel & Reiniger',
  },
  {
    patterns: [/\b(desinfektionstucher|desinfektionstuecher|desinfektion|aufhelltucher|aufhelltuecher)\b/],
    main: 'Haushalt',
    sub: 'Waschmittel & Reiniger',
  },
  {
    patterns: [/\b(glade|airwick|air wick|duftspray|lufterfrischer|raumduft|duftstecker|nachfuller|nachfueller|minispray)\b/],
    main: 'Haushalt',
    sub: 'Lufterfrischer & Raumduft',
  },
  {
    patterns: [/\b(brot|gebaeck|geback|semmel|weckerl|toast|baguette|croissant|kornspitz|brioche|wrap|tortilla)\b/],
    main: 'Lebensmittel',
    sub: 'Brot & Gebaeck',
  },
  {
    patterns: [/\b(milch|heumilch|vollmilch|buttermilch|teebutter|joghurt|jogurt|topfen|skyr|kefir|sauerrahm|schlagobers|obers|pudding|milchreis)\b/],
    main: 'Lebensmittel',
    sub: 'Milchprodukte',
  },
  {
    patterns: [/\b(kase|kaese|grosslochkaese|grosslochkase|mozzarella|feta|emmentaler|gouda|camembert|parmesan|bergkaese|bergkase|frischkaese|frischkase|schnittkaese|schnittkase|weinkaese|weinkase|oesterkron|osterkron|philadelphia|ricotta|mascarpone|cheddar|brie)\b/],
    main: 'Lebensmittel',
    sub: 'Kaese',
  },
  {
    patterns: [/\b(mehl|zucker|backpulver|vanillezucker|hefe|germ|staerke|starke|eier|ei|haferflocken|gries|griess|salz)\b/],
    main: 'Lebensmittel',
    sub: 'Backen & Grundnahrungsmittel',
  },
  {
    patterns: [/\b(fleisch|wurst|schinken|salami|speck|fisch|lachs|thunfisch|geflugel|gefluegel|huhn|hendl|pute|rind|schwein|faschiert|hackfleisch|leberkaese|leberkase|bratwurst|frankfurter|kaesekrainer|kasekrainer|garnelen|shrimp)\b/],
    main: 'Lebensmittel',
    sub: 'Fleisch, Wurst & Fisch',
  },
  {
    patterns: [/\b(bier|pils|weizen|radler|lager|helles|maerzen|marzen|flaschenbier|dosenbier|ottakringer|puntigamer|hirter|schwechater|wieselburger|goesser|gosser|stiegl|zipfer|zwettler|kozel)\b/],
    main: 'Getraenke',
    sub: 'Bier',
  },
  {
    patterns: [/\b(whisky|whiskey|rum|gin|vodka|likor|likoer|spirituose|spirituosen|schnaps|johnnie walker|glenfiddich|jaegermeister|jagermeister|batida|averna|amaro|kokoslikoer|kokoslikor|gurktaler|alpenkrauter|alpenkraeuter|aperitivo|spritz|bourbon)\b/],
    main: 'Getraenke',
    sub: 'Spirituosen',
  },
  {
    patterns: [/\b(rotwein|weisswein|rosewein|wein|sekt|prosecco|champagner|frizzante|zweigelt|chardonnay|traminer|riesling|welschriesling|veltliner|hugo|gluhwein|gluehwein|cuvée|cuvee)\b/],
    main: 'Getraenke',
    sub: 'Wein & Sekt',
  },
  {
    patterns: [/\b(mineralwasser|wasser|sprudel|voslauer|voeslauer|soda|sparkling)\b/],
    main: 'Getraenke',
    sub: 'Wasser',
  },
  {
    patterns: [/\b(cola|kola|limonade|limo|softdrink|energy|energydrink|eistee|fanta|sprite|mezzo|almdudler|red bull|tonic|bitter lemon|drink|superzero)\b/],
    main: 'Getraenke',
    sub: 'Softdrinks & Energy',
  },
  {
    patterns: [/\b(eis|eiscreme|cremissimo|eskimo|ben jerry|ben & jerry|cornetto)\b/],
    main: 'Lebensmittel',
    sub: 'Tiefkuehl- & Fertigprodukte',
  },
  {
    patterns: [/\b(schokolade|fruchtgummi|gummibaer|gummibaeren|haribo|milka|ferrero|raffaello|rocher|praline|pralinen|nougat|bonbon|zuckerl|kaugummi|orbit|smarties|zuckerlfrei|keks|kekse|butterkeks|waffel|waffelrollchen|waffelroellchen|chips|flips|nachos|doritos|bruschette|knabbermix|brotchips|popcorn|snack|soletti|merci|manner|mikado|niemetz|schwedenbomben|amicelli|celebrations|lorenz|xoxo|kelly|mozartkugeln|ildefonso|tony chocolonely|chocolonely|lindt|storck|nestle|mrbeast|feastables|riegel|proteinriegel|erdnusse|erdnuesse)\b/],
    main: 'Lebensmittel',
    sub: 'Suesswaren & Knabbereien',
  },
  {
    patterns: [/\b(knorr|felix|kotanyi|thomy|bechamel|bechamelsauce|sauce|sauces|bouillon|suppe|suppen|bruehe|bruhe|krauter|kraeuter|kronenol|kronenoel|rapsol|rapsoel|olivenoel|olivenol|sonnenblumenoel)\b/],
    main: 'Lebensmittel',
    sub: 'Saucen, Oele & Gewuerze',
  },
  {
    patterns: [/\b(blaetterteig|blatterteig|teig|tante fanny)\b/],
    main: 'Lebensmittel',
    sub: 'Backen & Grundnahrungsmittel',
  },
  {
    patterns: [/\b(fusilli|spaghetti|penne|nudel|nudeln|pasta|reis|risotto|risottoreis|passata|polpa|sugo|gnocchi|couscous|bulgur|bohnen|linsen|kichererbse|mais|ravioli)\b/],
    main: 'Lebensmittel',
    sub: 'Pasta, Reis & Konserven',
  },
  {
    patterns: [/\b(kaffee|cafe|caffe|moka|gemahlen|espresso|cappuccino|matcha|kaffeekapsel|nespresso|dolce gusto|nescafe|jacobs|tchibo|illy|lavazza|dallmayr|prodomo|meinl|praesident|prasident|teebeutel|teekanne|eistee|kraeutertee|krautertee|schwarztee|gruentee|gruenentee|gruntee|fruechtetee|fruchtetee|kamillentee|pfefferminztee|tee)\b/],
    main: 'Getraenke',
    sub: 'Kaffee & Tee',
  },
  {
    patterns: [/\b(saft|direktsaft|nektar|sirup|smoothie|smoothies|orangensaft|apfelsaft|multivitamin|rauch|true fruits|juice|rotbackchen|rotbaeckchen)\b/],
    main: 'Getraenke',
    sub: 'Saefte & Sirupe',
  },
  {
    patterns: [/\b(kakao|milchdrink|milchgetrank|milchgetraenk|joghurtdrink|proteindrink|eiskaffee)\b/],
    main: 'Getraenke',
    sub: 'Milchgetraenke',
  },
  {
    patterns: [/\b(paradeiser|tomate|tomaten|gurke|paprika|salat|kartoffel|erdapfel|zwiebel|karotte|moehre|mohre|radieschen|apfel|banane|zitrone|beere|erdbeere|erdbeeren|mango|mangos|nektarine|nektarinen|kresse)\b/],
    main: 'Lebensmittel',
    sub: 'Obst & Gemuese',
  },
  {
    patterns: [/\b(windel|windeln|pampers|feuchttucher|feuchttuecher|babycreme|babyshampoo)\b/],
    main: 'Drogerie / Hygiene',
    sub: 'Babyhygiene',
  },
  {
    patterns: [/\b(shampoo|spulung|spuelung|haarkur|haarspray|haarfarbe)\b/],
    main: 'Drogerie / Hygiene',
    sub: 'Haarpflege',
  },
  {
    patterns: [/\b(duschgel|dusch|deo|deodorant|bodylotion|seife|handcreme|sonnencreme|sonnenschutz|gesichtscreme|creme|lotion)\b/],
    main: 'Drogerie / Hygiene',
    sub: 'Koerperpflege',
  },
  {
    patterns: [/\b(waschmittel|weichspuler|weichspueler|reiniger|putzmittel|spulmittel|spuelmittel|entkalker|wc reiniger|badreiniger|glasreiniger|allzweckreiniger|duftspueler|duftspuler)\b/],
    main: 'Haushalt',
    sub: 'Waschmittel & Reiniger',
  },
  {
    patterns: [/\b(verlaengerungskabel|verlangerungskabel|kabeltrommel|steckdosenleiste|steckdose)\b/],
    main: 'Technik / Elektronik',
    sub: 'Werkzeug & Akkus',
  },
  {
    patterns: [/\b(gefrierschrank|kuehlschrank|kühlschrank|kuhlschrank|kuehltruhe|kühltruhe|no frost)\b/],
    main: 'Technik / Elektronik',
    sub: 'Kuechengeraete',
  },
  {
    patterns: [/\b(hochbeet|hochbeeterde|blumenerde|pflanzerde|komposterde|erde|duenger|dunger)\b/],
    main: 'Garten / Pflanzen',
    sub: 'Erde & Duenger',
  },
  {
    patterns: [/\b(gartenhaus|rasenmaeher|rasenmäher|heckenschere|schlauchwagen|bewaesserung|bewässerung|pavillon)\b/],
    main: 'Garten / Pflanzen',
    sub: 'Gartenzubehoer',
  },
  {
    patterns: [/\b(akku schrauber|akkuschrauber|bohrer|bit set|bit-set|werkzeugkoffer|schraubendreher|stichsaege|stichsäge)\b/],
    main: 'Technik / Elektronik',
    sub: 'Werkzeug & Akkus',
  },
  {
    patterns: [/\b(tv|smart tv|fernseher|oled|q led|qled|monitor|lautsprecher|soundbar)\b/],
    main: 'Technik / Elektronik',
    sub: 'Unterhaltungselektronik',
  },
  {
    patterns: [/\b(vitamin|magnesium|omega|zink|nahrungserganzung|nahrungsergaenzung|kapsel|kapseln|tablette|tabletten|pastille|pastillen|pflaster|hansaplast|kontaktlinsen|linsenloesung|linsenlosung|elektrolyt|dragee|dragees|abtei|melatonin|schwangerschaftstest|medizinprodukt|creatine|kreatin|teufelssalbe)\b/],
    main: 'Drogerie / Hygiene',
    sub: 'Gesundheit & Nahrungsergaenzung',
  },
  {
    patterns: [/\b(perfect fit|gourmet perle|gourmet gold|katzenfutter|katzennahrung|katzensnack)\b/],
    main: 'Tierbedarf',
    sub: 'Katzenfutter',
  },
  {
    patterns: [/\b(hundefutter|hundesnack|hundekeks|hundeleckerli|nassfutter hund|trockenfutter hund)\b/],
    main: 'Tierbedarf',
    sub: 'Hundefutter',
  },
  {
    patterns: [/\b(zooroyal|moon ranger|tierzubehoer|tierzubehor|kratzbaum|napf|leine|halsband)\b/],
    main: 'Tierbedarf',
    sub: 'Tierzubehoer',
  },
  {
    patterns: [/\b(spueltabs|spultabs|spuelmaschinentabs|spulmaschinentabs|geschirrspueltabs|geschirrspultabs|waschcaps|reiniger tabs|somat|dr beckmann|profissimo schmutzradierer|schmutzradierer)\b/],
    main: 'Haushalt',
    sub: 'Waschmittel & Reiniger',
  },
  {
    patterns: [/\b(formular|geschaftsbuch|geschaeftsbuch|briefkorb|stehsammler|etiketten|fotopapier|ordner|register|kuvert)\b/],
    main: 'Buero / Schule',
    sub: 'Papier & Ordnen',
  },
  {
    patterns: [/\b(schreibwaren|kugelschreiber|filzstift|textmarker|bleistift|notizbuch|collegeblock|heft|fineliner)\b/],
    main: 'Buero / Schule',
    sub: 'Schreibwaren',
  },
  {
    patterns: [/\b(drucker|scanner|toner|tinte|patrone|speichermedien|speicherkarte|festplatte|usb stick|usb-stick|computerzubehor|computerzubehoer|pc-zubehor|pc-zubehoer)\b/],
    main: 'Buero / Schule',
    sub: 'Drucker & Scanner',
  },
  {
    patterns: [/\b(hot wheels|pluesch|plueschtier)\b/],
    main: 'Freizeit / Sonstiges',
    sub: 'Spielzeug',
  },
  {
    patterns: [/\b(nintendo switch|videospiel|konsole|games)\b/],
    main: 'Freizeit / Sonstiges',
    sub: 'Games & Konsolen',
  },
  {
    patterns: [/\b(kontaktgrill|standgrill|heissluftfritteuse|heisluftfritteuse)\b/],
    main: 'Technik / Elektronik',
    sub: 'Kuechengeraete',
  },
];

function getNormalizedLabel(value) {
  return normalizeTitleForMatch(sanitizeWhitespace(value));
}

function isBroadCategoryLabel(value) {
  return /^(lebensmittel|getraenke|drogerie hygiene|haushalt|tierbedarf|garten pflanzen|kleidung mode|technik elektronik|freizeit sonstiges|baby kinder)$/.test(
    getNormalizedLabel(value)
  );
}

function getTexts({ title = '', contextText = '', sourceCategory = '', productGroups = [] }) {
  return [
    sanitizeWhitespace(title),
    sanitizeWhitespace(contextText),
    sanitizeWhitespace(sourceCategory),
    ...(Array.isArray(productGroups) ? productGroups.map((group) => sanitizeWhitespace(group?.title || '')) : []),
  ].filter(Boolean);
}

function scoreRule(texts, rule) {
  let score = 0;

  for (const text of texts) {
    const haystack = normalizeTitleForMatch(text);

    for (const pattern of rule.patterns || []) {
      if (pattern.test(haystack)) {
        score += text === texts[0] ? 4 : 2;
      }
    }
  }

  return score;
}

function findTaxonomyCategory(mainCategory) {
  const normalizedMain = getNormalizedLabel(mainCategory);
  return CATEGORY_TAXONOMY.find((category) => getNormalizedLabel(category.main) === normalizedMain) || null;
}

function getFallbackSubcategoryLabel(mainCategory) {
  return findTaxonomyCategory(mainCategory) ? 'Sonstiges' : '';
}

function findBestSubcategoryMatch({ texts = [], mainCategory = '' }) {
  const candidateCategories = mainCategory ? [findTaxonomyCategory(mainCategory)].filter(Boolean) : CATEGORY_TAXONOMY;
  let bestMatch = null;
  let bestScore = 0;

  for (const category of candidateCategories) {
    for (const subcategory of category.subcategories || []) {
      const score = scoreRule(texts, subcategory);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = {
          main: category.main,
          label: subcategory.label,
        };
      }
    }
  }

  if (!bestMatch || bestScore < 2) {
    return null;
  }

  return bestMatch;
}

function detectHardCategoryOverride({ title = '', contextText = '', sourceCategory = '', productGroups = [] }) {
  const haystack = normalizeTitleForMatch(getTexts({ title, contextText, sourceCategory, productGroups }).join(' '));

  for (const rule of HARD_CATEGORY_OVERRIDES) {
    if (rule.patterns.some((pattern) => pattern.test(haystack))) {
      return {
        primaryCategory: rule.main,
        secondaryCategory: rule.sub,
        confidence: 0.98,
      };
    }
  }

  return null;
}

function classifyOfferCategory({ title = '', contextText = '', sourceCategory = '', productGroups = [] }) {
  const hardOverride = detectHardCategoryOverride({ title, contextText, sourceCategory, productGroups });

  if (hardOverride) {
    return hardOverride;
  }

  const texts = getTexts({ title, contextText, sourceCategory, productGroups });
  let bestMain = null;
  let bestMainScore = 0;
  const bestSub = findBestSubcategoryMatch({ texts });

  for (const category of CATEGORY_TAXONOMY) {
    const mainScore = scoreRule(texts, category);

    if (mainScore > bestMainScore) {
      bestMain = category;
      bestMainScore = mainScore;
    }
  }

  if (bestSub) {
    return {
      primaryCategory: bestSub.main,
      secondaryCategory: bestSub.label,
      confidence: 0.88,
    };
  }

  if (bestMain && bestMainScore >= 2) {
    return {
      primaryCategory: bestMain.main,
      secondaryCategory: getFallbackSubcategoryLabel(bestMain.main),
      confidence: Math.min(1, 0.52 + bestMainScore * 0.06),
    };
  }

  return {
    primaryCategory: 'Unkategorisiert',
    secondaryCategory: '',
    confidence: 0.2,
  };
}

function determineOfferCategory({ title = '', contextText = '', sourceCategory = '', productGroups = [] }) {
  return classifyOfferCategory({ title, contextText, sourceCategory, productGroups }).primaryCategory;
}

function determineOfferSubcategory({ primaryCategory = '', sourceCategory = '', fallbackLabel = '', title = '', contextText = '', productGroups = [] }) {
  const classified = classifyOfferCategory({ title, contextText, sourceCategory, productGroups });
  const primary = sanitizeWhitespace(primaryCategory || classified.primaryCategory);
  const candidateTexts = [
    sanitizeWhitespace(sourceCategory),
    sanitizeWhitespace(fallbackLabel),
  ].filter(Boolean);

  if (
    classified.secondaryCategory
    && getNormalizedLabel(classified.primaryCategory) === getNormalizedLabel(primary)
    && getNormalizedLabel(classified.secondaryCategory) !== getNormalizedLabel(primary)
  ) {
    return classified.secondaryCategory;
  }

  const inferredMatch = findBestSubcategoryMatch({
    texts: getTexts({ title, contextText, sourceCategory, productGroups }),
    mainCategory: primary,
  });

  if (inferredMatch && getNormalizedLabel(inferredMatch.label) !== getNormalizedLabel(primary)) {
    return inferredMatch.label;
  }

  for (const text of candidateTexts) {
    if (!text || isBroadCategoryLabel(text) || getNormalizedLabel(text) === getNormalizedLabel(primary)) {
      continue;
    }

    const matched = findBestSubcategoryMatch({
      texts: [text],
      mainCategory: primary,
    });

    if (matched && getNormalizedLabel(matched.label) !== getNormalizedLabel(primary)) {
      return matched.label;
    }
  }

  return '';
}

function determineCategoryDecision({ title = '', contextText = '', sourceCategory = '', productGroups = [] }) {
  const classified = classifyOfferCategory({
    title,
    contextText,
    sourceCategory,
    productGroups,
  });
  const secondaryCategory = determineOfferSubcategory({
    primaryCategory: classified.primaryCategory,
    sourceCategory,
    fallbackLabel: classified.secondaryCategory,
    title,
    contextText,
    productGroups,
  });
  const hasSubcategory = Boolean(secondaryCategory);
  const secondaryConfidence = hasSubcategory
    ? Math.max(0.45, Math.min(0.95, classified.confidence - 0.04))
    : Math.min(0.35, classified.confidence);

  return {
    primaryCategory: classified.primaryCategory,
    secondaryCategory,
    categoryConfidence: classified.confidence,
    subcategoryConfidence: secondaryConfidence,
    needsReview: classified.confidence < 0.5 || !hasSubcategory,
    reviewReasons: [
      classified.confidence < 0.5 ? 'category-low-confidence' : '',
      !hasSubcategory ? 'subcategory-low-confidence' : '',
    ].filter(Boolean),
  };
}

function buildInclusiveScopeDecision() {
  return {
    included: true,
    reason: '',
  };
}

module.exports = {
  CATEGORY_TAXONOMY,
  classifyOfferCategory,
  determineCategoryDecision,
  determineOfferCategory,
  determineOfferSubcategory,
  buildInclusiveScopeDecision,
};
