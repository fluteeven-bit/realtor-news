// 要抓什麼：分類、Google 新聞的搜尋字、政府官方 RSS。要加減來源只改這一個檔。
// Google 的語法：空格＝都要有、OR＝其中一個、when:7d＝近 7 天（往回補資料時會換成 after/before）。

export const CATS = [
  { id: "rate", label: "利率房貸", icon: "🏦", google: [
    "房貸利率 when:7d",
    "(央行 升息 OR 央行 降息 OR 理監事會 利率) when:7d",
    "(青安 OR 新青安) when:7d",
    "(房貸成數 OR 寬限期 OR 銀行 限貸 OR 房貸 排隊) when:7d",
  ] },
  { id: "policy", label: "政策法規", icon: "🏛", google: [
    "(信用管制 OR 打炒房 OR 平均地權條例) when:7d",
    "(實價登錄 OR 預售屋 換約 OR 私法人 購屋) when:7d",
    "(社會住宅 OR 社宅 OR 租金補貼 OR 包租代管) when:7d",
    "(都更 OR 危老) when:7d",
    "內政部 (房市 OR 不動產 OR 住宅 OR 地政) when:7d",
  ] },
  { id: "tax", label: "稅務", icon: "🧾", google: [
    "(房地合一 OR 囤房稅 OR 房屋稅) when:7d",
    "(地價稅 OR 土地增值稅 OR 土增稅 OR 契稅) when:7d",
    "(遺產稅 OR 贈與稅) (房地產 OR 不動產 OR 房屋) when:14d",
    "(自用住宅 OR 重購退稅 OR 房東 租金) 稅 when:14d",
  ] },
  { id: "market", label: "全台行情", icon: "📈", google: [
    "(房價 OR 房市) (台北 OR 桃園 OR 新竹 OR 台中 OR 台南 OR 高雄) when:7d",
    "(建物買賣移轉 OR 買賣移轉棟數 OR 房市 交易量) when:7d",
    "(房價指數 OR 房價 漲跌 OR 實價 行情) when:7d",
    "(預售屋 OR 新成屋 OR 中古屋) 買氣 when:7d",
    "法拍屋 when:14d",
  ] },
  { id: "build", label: "建案土地", icon: "🏗", google: [
    "(新建案 OR 推案 OR 建商 推案) when:7d",
    "(土地標售 OR 地上權 OR 建商 買地 OR 合建) when:14d",
  ] },
  { id: "local", label: "在地新北", icon: "📍", google: [
    "(新莊 OR 泰山 OR 新埔 OR 板橋 OR 五股) (房價 OR 建案 OR 房市) when:7d",
    "(塭仔圳 OR 新莊副都心 OR 頭前重劃區 OR 新莊 重劃區) when:30d",
    "(北環段 OR 五股泰山輕軌 OR 萬大線 OR 新北捷運) when:30d",
  ] },
  { id: "dispute", label: "糾紛判例", icon: "⚖️", google: [
    "(房屋買賣 OR 房仲 OR 凶宅 OR 海砂屋 OR 漏水 OR 預售屋) 糾紛 when:14d",
    "(不動產 OR 房屋 OR 預售屋) 判決 when:14d",
  ] },
  { id: "ptt", label: "PTT 房屋板", icon: "💬", ptt: true },
];

// 政府官方 RSS：整個機關的新聞都會進來，只留標題對得上的。
const RE_TAX = /房屋稅|地價稅|土地增值稅|土增稅|契稅|房地合一|囤房|不動產|遺產稅|贈與稅|印花稅|自用住宅|房東|租金|地價|房屋|土地|囤房|重購/;
const RE_MOI = /不動產|住宅|社宅|租金|地政|實價|地籍|都更|都市更新|危老|建築|營建|國土|土地|房屋|租賃|經紀|地價|平均地權|公寓大廈|預售/;
const RE_CBC = /利率|理監事|五大銀行|新承做|信用管制|不動產|購屋|建築貸款|房貸|消費者貸款/;

export const OFFICIAL = [
  { id: "cbc", src: "中央銀行", url: "https://www.cbc.gov.tw/tw/rss-302-1.xml", re: RE_CBC,
    cats: (t) => (/信用管制|不動產/.test(t) ? ["rate", "policy"] : ["rate"]) },
  { id: "mof", src: "財政部", url: "https://www.mof.gov.tw/Rss/384fb3077bb349ea973e7fc6f13b6974", re: RE_TAX, cats: () => ["tax"] },
  { id: "dot", src: "財政部賦稅署", url: "https://www.dot.gov.tw/Rss/ch26", re: RE_TAX, cats: () => ["tax"] },
  { id: "moi-news", src: "內政部", url: "https://www.moi.gov.tw/OpenData.aspx?SN=76F358C679FAD4CF", re: RE_MOI, cats: () => ["policy"] },
  { id: "moi-draft", src: "內政部（草案預告）", url: "https://www.moi.gov.tw/OpenData.aspx?SN=3148769B8A76FD66", re: RE_MOI, cats: () => ["policy"] },
  { id: "moi-rule", src: "內政部（法規發布）", url: "https://www.moi.gov.tw/OpenData.aspx?SN=B55985D8C9CDC53A", re: RE_MOI, cats: () => ["policy"] },
];

// 分類優先順序：同一則同時屬於好幾類時，第一個標籤用這個順序挑
export const CAT_ORDER = ["rate", "policy", "tax", "market", "build", "local", "dispute", "ptt", "kw"];
