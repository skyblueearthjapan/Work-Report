// テスト用：ローカルDBにサンプル案件・工番マスター（本番から数件を写した例）・作業員名簿を入れる。
// アプリのコピー（server/ がある階層）に置いて実行する（README.md 参照）。
const store = require('./server/store');
store.seedSampleDataIfEmpty();
store.setMaster({
  kobans: [
    { koban: 'LW25004', uketsuke: '住友建機㈱', nohinSaki: '住友建機㈱', basho: '千葉県千葉市稲毛区', kishu: 'LN-2400' },
    { koban: 'LW23125', uketsuke: '住友建機㈱', nohinSaki: '住友建機㈱', basho: '千葉県千葉市稲毛区長沼原町731-1', kishu: '4ton応用機アタッチメントポジショナー' },
    { koban: 'LW25083', uketsuke: '三星重工業', nohinSaki: '三星重工業', basho: '慶尚南道巨済市長坪3路80', kishu: '13m切断走行台車' },
    { koban: 'TS25200', uketsuke: '㈱山善 九州営業部', nohinSaki: '㈱三星テクノ', basho: '福岡県朝倉市山田2273-1', kishu: '袋ナット（M20標準）' },
    { koban: 'TS25201', uketsuke: 'ユアサネオテック㈱', nohinSaki: '日鉄建材㈱ 君津製造所', basho: '千葉県君津市君津1番地', kishu: 'ツールチェンジャーマスター（コスメック）' },
    { koban: 'TS26052', uketsuke: '株式会社赤木鉄工所', nohinSaki: '株式会社赤木鉄工所', basho: '宮崎県東諸県郡国富町大字宮王丸685', kishu: 'NSK3000C' }
  ],
  staff: [
    { code: '1001', name: '田村 修二', dept: '機械設計' }, { code: '1003', name: '片岡 暢', dept: 'TSC' },
    { code: '1010', name: '今泉', dept: '組立・塗装' }, { code: '1011', name: '小林 椿', dept: '組立・塗装' }
  ],
  depts: ['組立・塗装', '機械設計', 'TSC'],
  importedAt: '2026-09-23 06:07'
});
store.saveSettings(Object.assign(store.getSettings(), { travelDepts: '組立・塗装,機械設計,TSC' }));
console.log('seeded');
