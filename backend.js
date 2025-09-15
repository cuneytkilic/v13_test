var express = require('express');
var app = express();
var sql = require("mssql");
var bodyparser = require('body-parser');
const fetch = require("node-fetch");
const open = require('open');
const axios = require('axios');
const ping = require('ping');
const notifier = require('node-notifier');
const path = require('path');
const PORT = 3013;
const cors = require("cors");
app.use(cors()); // ← CORS'a izin ver

console.log("index.html ile web arayuzunden takip edebilmek icin node backend.js koduna ek olarak, baska konsol ac ve 'npx serve' calistir.")

let amount = 5; // X dolarlık coin alınacak anlamına geliyor.
let max_amount = 50;
let min_amount = 20;
let alinabilir_max_coin_sayisi = 1; //amount dinamik hesaplamada kullanılacak.
let max_alim = alinabilir_max_coin_sayisi //alinabilir_max_coin_sayisi-8; //alım sinyalleri geldiğinde alım yapılabilecek max coin sayısını belirtir.
let yeni_kaldirac = 3;
let tek_seferde_alim_sayisi = 1;
let kademeli_alim_sayisi = 30
let sell_order_sayisi = 1 //yukaridan_satis_emri_sayisi kadar alınacak ama sell_order_sayisi kadar yukarıdan satış emri koyulacak.
let yukaridan_satis_emri_sayisi = 1 //long sinyali geldiğinde (amount * yukaridan_satis_emri_sayisi) kadarlık marketBuy işlemi yapılacak.
let leverage = 10; // kaldıraç 20 üstüne çıkartma! -> 15x ideal görünüyor.


let son_guncelleme_saati = new Date().toTimeString().slice(0,5);
let logs = null
let atr_min = 2;
let atr_max = 10;
let katsayi = 1; //1:%50, 2:%66, 3:%75, 4:%80 (ortalamayı yükseltirken sonraki alıma yakınlık yüzdesini belirlemede kullanıyoruz.)
let profit_rate = 0.01; //0.01 => %1 kar oranı (her al&sat işleminden elde edilecek kar oranıdır.)
let max_kademeli_alim_sayisi = 2;
let btc = null;
let atr_kat = 4;
let tickSize_stepSize_list = []
let takip_edilen_coin_sayisi = 0;
let alttan_alim_yuzdesi = 10
let long_list = []; //rsi yükselince alınacak coinler
let short_list = []; //rsi düşünce alınacak coinler
let ignored_coin_list = ["SAFEUSDT","DRIFTUSDT","GRASSUSDT","TRBUSDT","AI16ZUSDT","AIXBTUSDT","MASKUSDT","MELANIAUSDT","TRUMPUSDT","LAYERUSDT","OMUSDT","OGNUSDT","BTCUSDT","USDCUSDT","ETHUSDT","BNBUSDT","BTCDOMUSDT","XRPUSDT","XEMUSDT","XMRUSDT"]//["USDCUSDT","BTCUSDT","ETHUSDT","BNBUSDT","BTCDOMUSDT","XRPUSDT","OMGUSDT","XEMUSDT","WAVESUSDT","LEVERUSDT","REEFUSDT","LOOMUSDT","DOTUSDT","POWRUSDT","ARKMUSDT","WLDUSDT","BONDUSDT","TRUUSDT","JOEUSDT","ACHUSDT","PHBUSDT","INJUSDT","FLOWUSDT","FETUSDT","BLURUSDT","SANDUSDT","SEIUSDT","LDOUSDT","PYTHUSDT","MATICUSDT","ENJUSDT","LPTUSDT","WIFUSDT","XLMUSDT"/*'BIGTIMEUSDT','ZRXUSDT','XMRUSDT','BSVUSDT','USTCUSDT','YFIUSDT','BTCUSDT','BTCDOMUSDT','XRPUSDT','USDCUSDT','ADAUSDT','BNBUSDT','ETHUSDT','IDEXUSDT','BNXUSDT','NEOUSDT','CVXUSDT','SFPUSDT','CHZUSDT','ETHWUSDT','UNFIUSDT','MTLUSDT'*/]
let coin_market_cap_api_key = "408297cf-3642-4237-b036-35e4e81baa33";
let limit = 200;
let atr_list=[]
let alis_sayisi = 0
let satis_sayisi = 0
let trading_status = 0

let local_alis_sayisi = 0
let local_satis_sayisi = 0
let emirler_arasi_fiyat_araligi = null

let satis_bekleyen_bot_sayisi = null


let mail_alis_sayisi = 6
let mail_satis_sayisi = 8

let ilk_giris_fiyati = null
let limit_buy_list = []
let ilk_sinyal_zamani = new Date().getTime();
let kac_kere_alim_yapilsin = 10

let amountun_kac_kati_alinacak = 10 // ilk alımı yaptıktan sonra yukarı kaç tane tp emri koyulacak ? ayrıca amount'un kaç katı alım yapılacağını belirlemiş oluyoruz.
let ekstra_alim_sayisi = 0
let kazanc_listesi = []


// SQL Server bağlantı ayarları
const config = {
    user: 'test3',      // SQL Server kullanıcı adı
    password: 'fb190719',           // SQL Server şifresi
    server: 'DESKTOP-F7E86LQ',       // Sunucu adı
    database: 'cuneyt',      // Veritabanı adı
    options: {
        encrypt: false,              // Yerel SQL Server için şifreleme kapalı olabilir
        trustServerCertificate: true, // Şifreleme devre dışı ise güvenilir sertifika
        enableArithAbort: true       // Uyarıyı gidermek için bu ayarı ekleyin
    }
};

async function get_trading_status() { // status_id=1 ise trading açık demektir, 0 ise kapalı
    try {
        const pool = await sql.connect(config);
        const result = await pool.request().query('SELECT * FROM trade');
        
        // İlk satırdaki status_id değerini al
        // status_id=1 ise trading açık demektir, 0 ise kapalı
        const status_id = result.recordset[0].status_id;
        await sql.close();
        return status_id
    } 
    catch (err) {
        console.error('Veritabanı hatası aldığımız için trading_status=0 yani trading açık bot devam edecek demektir HATA: ', err);
        return 1 // 1: trading kapalı demektir
    }
}

let satilan_coin_sayisi = 0;
let satilan_fartcoin = 0;
let satilan_popcat = 0;

let tp_order_id_list = []
let buy_order_id_list = []
let coin_analiz = []
let toplam_kasa = null

const Binance = require('node-binance-api');
const binance = new Binance().options({
    APIKEY: 'BXL5lvixqVEZY5EsTjO54xqjan42kJPUd6547oKmtPoc9YD3AoHvuWQ4K50cinux', //cüneyt
    APISECRET: 'pmYUkQLgyKj959aoxvjtKojqT2xzO4pWfHpTeGDsTwXk4QyEz39CQasv3eK1ju6P', //cüneyt
    // APIKEY: 'KoankrgkpVEp6u6dljT7AebXNo5nhbW07ovdDCWpxXDfrLp1mrIbNLtnpeGTJRID', //ergün
    // APISECRET: 'RgEd5U38P6Ykoah66uCljBKRLiGDDOIGFqsNdEdABHaGVVF5ORsgKZysPgqAGydc', //ergün
    
    'recvWindow': 10000000,
    baseUrl: "http://localhost:4000"
});

app.use(bodyparser.json({ type: 'application/json' }));
app.use(bodyparser.urlencoded({ extended: true }));

let buy_count = 0;
let coin_list = [];
let coin_arr = [];
let atr_range = [0,0,0,0,0]
//sıfırıncı indis 0-1 arası atr değerine sahip coin sayısını tutuyor.
//birinci indis 1-2 arası atr değerine sahip coin sayısını tutuyor.
//ikinci indis 2-3 arası atr değerine sahip coin sayısını tutuyor.
//Son eleman ise atr>=3 olan coin sayısını tutuyor.

let tepe_fiyati = null;
let taranan_coin_sayisi = 0
let min_atr = 3
// let coin_name = "POPCATUSDT"
let max_alim_sayisi = 3;
let total_degisim = 0;
let total_usd = 0
let marketSell_sayisi = 0
let limitSell_sayisi = 0

get_all_tickSize_stepSize();
mail_gonder_24h() //24 saatte bir bilgilendirme maili gönderir.

let bot_listesi = [];

info_yazdir()

//program ilk başlatıldığında 2 botu burada başlatıyoruz.
let bot_sayisi = 2;
let trading = 0; // 0: trading kapalı, 1: trading açık

btc_1h_rsi_kontrol(); //btc 1h rsi takibine gönderiyoruz.
// btc_4h_rsi_kontrol(); //btc 4h rsi takibine gönderiyoruz.
before_start();

async function before_start() {
    //bot_listesi'ni oluştur.
    for(let i=1;i<=bot_sayisi;i++){
        bot_listesi.push({"no":i, "coin_name": null,"alim_sinyali_bekleniyor":0, "satis_sinyali_bekleniyor":0})
    }
    
    let coin_list = await coinler();
    console.log(new Date().toLocaleTimeString() + " - bot_listesi: " + bot_listesi.length + " - coin_sayisi: " + coin_list.length + " - amount: " + amount);

    

    try {
        while (true) {
            await bekle_60sn();
            if(true/*trading==1*/){
                await taraBatch(coin_list, 100);
                console.log(new Date().toLocaleTimeString() + " - dakikalik tarama bitti.")
            }
        }
    } 
    catch (error) {
        console.log(error)
        return
    }
    



    
}

async function btc_1h_rsi_kontrol() {
    //btc 1h rsi sinyali bekleniyor...

    while (true) {
        await bekle_60dk();
        let data = await saat_get_data("BTCUSDT")
        await saat_calculate_rsi(data);
        let rsi_1h = parseFloat(data[data.length-2]['rsi']);
        
        if(rsi_1h<30){
            amount = 2
            trading = 1 //trading açık
            console.log(new Date().toLocaleTimeString() + " - Trading aktif edildi. BTC 1H RSI: " + rsi_1h.toFixed(2) + " - amount: " + amount);

            while (true) {
                await bekle_60dk();
                let data = await saat_get_data("BTCUSDT")
                await saat_calculate_rsi(data);
                let rsi_1h = parseFloat(data[data.length-2]['rsi']);

                if(rsi_1h>67){
                    amount = 0
                    trading = 0 //trading kapalı
                    console.log(new Date().toLocaleTimeString() + " - Trading durduruldu.  BTC 1H RSI: " + rsi_1h.toFixed(2) + " - amount: " + amount);
                    process.exit(1);
                }
                else{
                    console.log(new Date().toLocaleTimeString() + " - BTC 1H RSI: " + rsi_1h.toFixed(2) + " - amount: " + amount);
                }
            }
        }
        else if(rsi_1h<40){
            amount = 2
            trading = 1 //trading açık
            console.log(new Date().toLocaleTimeString() + " - Trading aktif edildi. BTC 1H RSI: " + rsi_1h.toFixed(2) + " - amount: " + amount);
        }
        else{
            console.log(new Date().toLocaleTimeString() + " - BTC 1H RSI: " + rsi_1h.toFixed(2) + " - amount: " + amount);
        }
    }
}

async function taraBatch(coin_list, batchSize) {
    for (let i = 0; i < coin_list.length; i += batchSize) {
        const batch = coin_list.slice(i, i + batchSize);
        await Promise.all(batch.map(c => coin_tara(c)));
        await bekle(0.2); // küçük gecikme (rate limit için)
    }
}




// start_bot(bot_listesi[0]);
async function start_bot(bot, coin_name){ //RSI, long sinyali geldiğinde bot başlayacak.
    
    //Order History sekmesindeki verileri bu request ile çekebiliyoruz.
    //console.info( await binance.futuresOrderStatus( coin_name, {orderId: 7529223630} ) );
    console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - " + bot.no + ". bot baslatildi. amount: " + amount)    

    while (true) {
        
        let kilit = 0
        let atr_degisim = null
        let buy_price = null
        let quantity = null
        let buy_order_id = null
        let tp_order_id = null
        let buy = null
        let sell = null
        let marketBuy_json = null

        //RAM Yonetimi - Değişkenleri 1 kere tanımla sürekli let ile değişken tanımlanmaz.
        let data = null
        let rsi = null
        let rsi_2 = null
        let tickSize = null
        let tp_price = null
        let json = null
        let bildirim_baslik = null
        let bildirim_mesaj = null
        let alim_bekleyen_bot_sayisi = null
        let lastPrice = null
        let degisim = null
        let real_degisim = null
        let status = null

        alim_bekleyen_bot_sayisi = bot_listesi.filter(bot => bot.coin_name === coin_name && bot.alim_sinyali_bekleniyor === 1).length;
        
        if(alim_bekleyen_bot_sayisi>1){
            bot.alim_sinyali_bekleniyor=0
            bot.satis_sinyali_bekleniyor=0
            bot.coin_name = null
            console.log(new Date().toLocaleTimeString() + " - " + bot.no + ". bot durduruldu(1)");
            info_yazdir();
            // console.log(bot_listesi);
            return
        }
        else{
            bot.alim_sinyali_bekleniyor=1
            bot.coin_name = coin_name
            info_yazdir();
            // console.log(bot_listesi);
        }

        
        
        //alım döngüsü
        while (true) {
            try {
                data = await dk_calculate_indicators(coin_name);
                rsi = data[data.length-2].rsi
                rsi_2 = data[data.length-3].rsi
                buy_price = parseFloat(data[data.length-2].close)
                atr_degisim = parseFloat(data[data.length-2].atr_degisim)
                
                let bekleyen_coinler = await get_bekleyen_list("test")
                if (bekleyen_coinler.includes(coin_name)) {
                    console.log(new Date().toLocaleTimeString() + " - daha once alindi, tekrar alinmayacak. coin_name: " + coin_name);
                    return;
                }
                
                if(true/*rsi_2<30 && rsi>30 && atr_degisim>1*/){
                    
                    marketBuy_json = await long_marketBuy(coin_name, buy_price);
                    // create_limit_order(coin_name, marketBuy_json.quantity, 0.99);
                    kademeli_alim_diz(coin_name, marketBuy_json.quantity)
                    
                    buy = ((await binance.futuresAllOrders( coin_name, {orderId: marketBuy_json.buy_order_id} )).filter(json => json.orderId==marketBuy_json.buy_order_id && json.side=="BUY"))[0]
                    
                    if (!buy) {
                        open('D:\\worth.mp4');
                        buy = {
                            "avgPrice": buy_price,
                            "cumQuote": buy_price*marketBuy_json.quantity
                        }
                        console.log(new Date().toLocaleTimeString() + " - buy undefined HATAsı verdi. elle atama yapıldı.");
                        console.log(buy)
                    }

                    // limit satış emri oluştur.
                    tickSize = await find_tickSize_price(coin_name);
                    // tp_price = parseFloat(buy_price * (1+profit_rate)).toFixed(tickSize); // %0,5 tp
                    tp_price = parseFloat(parseFloat(buy.avgPrice) * (1+profit_rate)).toFixed(tickSize);

                    // TAKE PROFIT ORDER oluştur.
                    json = await binance.futuresSell(coin_name, marketBuy_json.quantity, tp_price, { reduceOnly: true, timeInForce: "GTC" }); // TP: SATIŞ EMRİ
                    tp_order_id = json.orderId

                    
                    
                    




                    bot.alim_sinyali_bekleniyor=0
                    bot.satis_sinyali_bekleniyor=1
                    
                    info_yazdir();
                    // console.log(bot_listesi);
                    bildirim_baslik = coin_name + " - BOT: " + bot.no;
                    bildirim_mesaj = "BUY";
                    bildirimGonder(bildirim_baslik, bildirim_mesaj, "buy");

                    break;
                }

                await bekle_60sn();
            } 
            catch (error) {
                console.error(new Date().toLocaleTimeString() + " - HATA: ", error.stack || error);
            }
            
            
        }
            

        //satış döngüsü
        while (true) {

            try{
                alim_bekleyen_bot_sayisi = bot_listesi.filter(bot => bot.coin_name === coin_name && bot.alim_sinyali_bekleniyor === 1).length;
                if(alim_bekleyen_bot_sayisi>1){
                    bot.alim_sinyali_bekleniyor=0
                    bot.satis_sinyali_bekleniyor=0
                    bot.coin_name = null
                    console.log(new Date().toLocaleTimeString() + " - " + bot.no + ". bot durduruldu(2)");
                    info_yazdir();
                    // console.log(bot_listesi);
                    return
                }

                
                data = await dk_calculate_indicators(coin_name);
                rsi = parseFloat(data[data.length-2].rsi)
                // rsi_2 = data[data.length-3].rsi
                lastPrice = parseFloat(data[data.length-2].close)
                degisim = parseFloat((lastPrice-buy_price)/buy_price*100)
                real_degisim = parseFloat((lastPrice-parseFloat(buy.avgPrice))/parseFloat(buy.avgPrice)*100)

                /*status = await binance.futuresAllOrders( coin_name, {orderId: tp_order_id} ).then(json => json[0].status)
                if(status == "FILLED"){
                    // long_marketSell_order(coin_name);
                    // cancel_all_orders(coin_name);
                    let order_history = (await binance.futuresAllOrders( coin_name, {orderId: marketBuy_json.buy_order_id} ))
                    sell = (order_history.filter(json => json.orderId==tp_order_id && json.side=="SELL"))[0]

                    if (!sell) {
                        
                        sell = {
                            "avgPrice": buy.avgPrice
                        }
                        console.log(new Date().toLocaleTimeString() + " - 1. sell undefined HATAsı verdi. elle atama yapıldı.");
                        console.log(sell)
                    }
                    
                    let result_degisim = ((parseFloat(sell.avgPrice)-parseFloat(buy.avgPrice))/parseFloat(buy.avgPrice))
                    let kar_zarar_usd = parseFloat(buy.cumQuote) * result_degisim;
                    total_usd += kar_zarar_usd
                    
                    satilan_coin_sayisi++
                    limitSell_sayisi++

                    console.log("alis_fiyati: " + parseFloat(buy.avgPrice) + " - satis_fiyati: " + parseFloat(sell.avgPrice) + " - quantity: " + marketBuy_json.quantity + " - total: " + parseFloat(buy.cumQuote) + " - result_degisim: " + (100*result_degisim).toFixed(2) + " - kar_zarar_usd: " + kar_zarar_usd.toFixed(2) + " - total_usd: " + total_usd.toFixed(2))
                    console.log(new Date().toLocaleTimeString() + " - " + satilan_coin_sayisi + ". satis yapildi. Tahmini kar: %" + parseFloat(satilan_coin_sayisi*profit_rate*100).toFixed(2) + " - status: " + status + " - BOT NO: " + bot.no)
                    bot.alim_sinyali_bekleniyor=0
                    bot.satis_sinyali_bekleniyor=0

                    if(coin_name == "FARTCOINUSDT"){
                        satilan_fartcoin++
                    }
                    else if(coin_name == "POPCATUSDT"){
                        satilan_popcat++
                    }
                    
                    
                    info_yazdir();
                    // console.log(bot_listesi);

                    bildirim_baslik = coin_name + " - BOT: " + bot.no;
                    bildirim_mesaj = "SELL - Tahmini kar: %" + parseFloat(satilan_coin_sayisi*profit_rate*100).toFixed(2);
                    bildirimGonder(bildirim_baslik, bildirim_mesaj, "sell");

                    return
                }
                else if(status == "CANCELED" || status == "EXPIRED"){
                    bot.alim_sinyali_bekleniyor=0
                    bot.satis_sinyali_bekleniyor=0
                    console.log(new Date().toLocaleTimeString() + " - GECERSIZ ORDER, STATUS: " + status);
                    return
                }
                else */if(rsi>63 /*&& degisim>0.1 && real_degisim>0.1*/){
                    bot.alim_sinyali_bekleniyor=0
                    bot.satis_sinyali_bekleniyor=0
                    open('D:\\worth.mp4')
                    let entryPrice = await get_entryPrice(coin_name);
                    buy.avgPrice = entryPrice
                    let marketSell_order_id = await long_marketSell(coin_name);
                    // await cancel_buy_order(coin_name, tp_order_id);
                    cancel_all_orders(coin_name);
                    let order_history = (await binance.futuresAllOrders( coin_name, {orderId: marketSell_order_id} ))
                    sell = (order_history.filter(json => json.orderId==marketSell_order_id && json.side=="SELL"))[0]

                    if (!sell) {
                        
                        sell = {
                            "avgPrice": lastPrice
                        }
                        console.log(new Date().toLocaleTimeString() + " - 2. sell undefined HATAsı verdi. elle atama yapıldı.");
                        console.log(sell)
                    }






                    

                    let result_degisim = ((parseFloat(sell.avgPrice)-parseFloat(buy.avgPrice))/parseFloat(buy.avgPrice))
                    let kar_zarar_usd = parseFloat(sell.cumQuote) * result_degisim
                    total_usd += kar_zarar_usd

                    marketSell_sayisi++

                    console.log("alis_fiyati: " + parseFloat(buy.avgPrice) + " - satis_fiyati: " + parseFloat(sell.avgPrice) + " - total: " + parseFloat(sell.cumQuote).toFixed(0) + " - result_degisim: " + (100*result_degisim).toFixed(2) + " - kar_zarar_usd: " + kar_zarar_usd.toFixed(2) + " - total_usd: " + total_usd.toFixed(2))
                    console.log(new Date().toLocaleTimeString() + " - TP emri iptal edildi ve rsi>63 satisi yapildi. degisim: " + degisim.toFixed(2) + " - BOT NO: " + bot.no + " - lastPrice: " + lastPrice + " - buy_price: " + buy_price)
                    
                    info_yazdir();
                    // console.log(bot_listesi);

                    bildirim_baslik = coin_name + " - BOT: " + bot.no;
                    bildirim_mesaj = "rsi>63 SELL - degisim: %" + degisim.toFixed(2);
                    bildirimGonder(bildirim_baslik, bildirim_mesaj, "sell");

                    return
                }

                await bekle_60sn();
            
            } catch (error) {
                console.error(new Date().toLocaleTimeString() + " - HATA: ", error.stack || error);
            }
        }
    }

}

async function create_limit_order(coin_name, quantity, asagidan_alim_orani) {
    let entryPrice = await get_entryPrice(coin_name);
    let ticksize = await find_tickSize_price(coin_name);
    let limit_price = parseFloat(entryPrice*asagidan_alim_orani).toFixed(ticksize)

    const limitOrder = await binance.futuresBuy(coin_name, quantity, limit_price, { timeInForce: 'GTX' }); //code: -5022 hatasından dolayı chatgpt çözümü//
    if (limitOrder && limitOrder.orderId) {
        return
    }
    else {
        // open('D:\\horoz_alarm.mp4');
        console.log(new Date().toLocaleTimeString() + " - create_limit_order() fonksiyonunda hata verdi. limit_price: " + limit_price + " - entryPrice: " + entryPrice + " - rate: " + asagidan_alim_orani)
        console.log(limitOrder)
        create_limit_order(coin_name, quantity, asagidan_alim_orani-0.01)
        return
    }

}

async function coin_tara(coin_name) {
    let data = await dk_calculate_indicators(coin_name);
    let rsi = data[data.length-2].rsi
    let rsi_2 = data[data.length-3].rsi
    let atr_degisim = parseFloat(data[data.length-2].atr_degisim)
    
    if(rsi_2<30 && rsi>30 && atr_degisim>2){
        for(let i=1;i<=bot_listesi.length;i++){
            if(bot_listesi[i].alim_sinyali_bekleniyor==0 && bot_listesi[i].satis_sinyali_bekleniyor==0){
                let data = await saat_get_data(coin_name)
                await saat_calculate_rsi(data);
                let rsi_1h = parseFloat(data[data.length-2]['rsi'])

                if(rsi_1h>=30){
                    console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - RSI: " + rsi_1h.toFixed(2) + " oldugu icin alinmadi.");
                    return
                }

                start_bot(bot_listesi[i],coin_name);
                console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - ATR: " + atr_degisim.toFixed(2) + " - bot_no: "  + i );
                return;
            }
        }

        console.log(new Date().toLocaleTimeString() + " - bosta bot olmadigi icin " + coin_name + " alinmadi.");
    }
}


async function getCommissionAndFundingFromDate(coin_name, baslangic_tarihi) {
  try {
    // Tarihi timestamp (ms) olarak al
    let startTime = new Date(baslangic_tarihi).getTime();

    // Gelir kayıtlarını çek
    let income = await binance.futuresIncome({symbol: coin_name, startTime: startTime, limit: 1000 });

    let komisyon = 0, fundingFee = 0;

    for (let i = 0; i < income.length; i++) {
      let row = income[i];

      if (row.incomeType === "COMMISSION") {
        if (row.asset === "BNB") {
          // BNB komisyonunu USDT'ye çevir
          let fiyat = await binance.futuresPrices({ symbol: "BNBUSDT" });
          komisyon += parseFloat(row.income) * parseFloat(fiyat.price);
        } else if (row.asset === "USDT") {
          komisyon += parseFloat(row.income);
        }
      } else if (row.incomeType === "FUNDING_FEE") {
        fundingFee += parseFloat(row.income);
      }
    }

    return { 
      coin_name,
      komisyon, 
      fundingFee 
    };

  } catch (err) {
    console.error("Hata:", err.body || err);
    throw err;
  }
}

async function rsi_1h_kontrol(coin_name){
    while (true) {

        let data = await saat_get_data(coin_name)
        await saat_calculate_rsi(data);
        let rsi_1h = parseFloat(data[data.length-2]['rsi'])

        let rsi_4h = await get_rsi_4h(coin_name);
        
        console.log(new Date().toLocaleTimeString() + " - RSI 1h: " + rsi_1h.toFixed(2) + " - RSI 4h: " + rsi_4h)

        if(true/*rsi_1h<30 || rsi_4h<30*/){
            for(let i=0;i<bot_listesi.length;i++){
                if(bot_listesi[i].alim_sinyali_bekleniyor==0 && bot_listesi[i].satis_sinyali_bekleniyor==0){
                    start_bot(bot_listesi[i], coin_name);
                    console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - rsi<30 oldugu icin bot baslatildi.")
                    return
                }
            }
            
            return
        }
        // if(btc_rsi_4h<30){
        //     break;
        // }

        await bekle_60dk();
    }
}

async function btc_4h_rsi_kontrol(){
    try {

        while (true) {

            await bekle_4h();
            data = await get_data_4h("BTCUSDT");
            await saat_calculate_rsi(data);
            let rsi_4h = parseFloat(data[data.length-2]['rsi'])
            // let rsi_4h_2 = parseFloat(data[data.length-3]['rsi'])

            if(rsi_4h<30){
                amount = 30;
                trading = 1; //trading açık
                console.log(new Date().toLocaleTimeString() + " - BTC 4h RSI 30'un altina dustu: " + rsi_4h.toFixed(2) + " - amount: " + amount);
            }
            else{
                console.log(new Date().toLocaleTimeString() + " - BTC 4h RSI: " + rsi_4h.toFixed(2) + " - amount: " + amount);
            }
            
        }

    } catch (error) {
        console.log(error)
    }
}

async function get_data_4h(coin_name){
    let data = []
    let durum = true;

    try {
        while (durum == true) {
            await binance.futuresCandles(coin_name, "4h", {limit:500})
            .then(json => {
                let sonMumZamani = new Date(json[json.length - 1][0]); // mumun açılış zamanı
                let sonMumSaat = sonMumZamani.getHours();
                let simdiSaat = new Date().getHours();

                // Yeni mum açıldı mı? (tam 4 saatlik dilim ve şimdiki saat ile eşleşiyorsa)
                if ([3,7,11,15,19,23].includes(simdiSaat) && sonMumSaat === simdiSaat){
                    durum = false;

                    for(let i=0; i<json.length; i++){
                        data.push({
                            'coin_name': coin_name,
                            'open': parseFloat(json[i][1]), 
                            'high': parseFloat(json[i][2]), 
                            'low': parseFloat(json[i][3]), 
                            'close': parseFloat(json[i][4]), 
                            'volume': parseFloat(json[i][5]), 
                            'date': new Date(json[i][0]).toLocaleDateString(), 
                            'time': new Date(json[i][0]).toLocaleTimeString(),
                            'saat': new Date(json[i][0]).getHours()
                        })
                    }
                } 
                else {
                    durum = true;
                }   
            })

            if (durum == true) {
                await bekle(1); // 1 saniye bekle
            }
        }
    } 
    catch (error) {
        return null
    }

    return data
}


async function mail_gonder_24h() { //24 saatte bir bilgilendirme maili gönderir.
    //saat kaçta mail gönderileceğini belirleyen fonksiyon.
    await waitUntil(17,0);

    while(true){

        if(limitSell_sayisi>0){
            let toplam_kasa = await get_total_balance();
            let beklenen_aylik_min_kazanc = (toplam_kasa*0.05).toFixed(2) //aylık min %5'ten hesaplandı.
            let beklenen_gunluk_min_kazanc =(beklenen_aylik_min_kazanc/30).toFixed(2)

            let mail_konu = new Date().toLocaleTimeString() + " - 24 Saatlik Bilgilendirme v13"
            let mail_mesaj = "Aylık %5 kar için Beklenen günlük min kazanç: $" + beklenen_gunluk_min_kazanc + "\n\nmarketSell_sayisi: " + marketSell_sayisi + "\nlimitSell_sayisi: " + limitSell_sayisi + "\n\nBrüt Kar/Zarar: " + total_usd.toFixed(2) + "\nNet Kar/Zarar: " + (total_usd*0.8).toFixed(2)
            send_mail_cuneyt(mail_konu, mail_mesaj);
            
            console.log(new Date().toLocaleTimeString() + " - satilan_coin_sayisi degiskeni sifirlandi.")
            satilan_coin_sayisi = 0
            satilan_fartcoin = 0
            satilan_popcat = 0
            total_usd = 0
            limitSell_sayisi = 0
            marketSell_sayisi = 0
        }
        else{
            await bekle(60*60*24); //satış yapılmadı ise 24 saat sonra tekrar limit satış sayısı kontrol edilecek.
        }

        

    }
}

async function info_yazdir() {
    satis_bekleyen_bot_sayisi = bot_listesi.filter(bot => bot.satis_sinyali_bekleniyor === 1).length;
    console.log(`${new Date().toLocaleTimeString()} - satis_bekleyen_bot_sayisi: ${satis_bekleyen_bot_sayisi}\n`);
}

async function waitUntil(targetHour, targetMinute) {
  const now = new Date();

  // Hedef zamanı bugüne ayarla
  const target = new Date();
  target.setHours(targetHour, targetMinute, 0, 0);

  // Eğer hedef zaman geçmişse -> yarına ayarla
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }

  // Milisaniye farkını saniyeye çevir
  const seconds = Math.floor((target - now) / 1000);
  await bekle(seconds);
}

async function bekle_4h() {
    let now = new Date();
    let saat = now.getHours();
    // let dakika = now.getMinutes();
    // let saniye = now.getSeconds();

    // 4 saatlik mumların başladığı saatler
    const mumBaslangicSaatleri = [3, 7, 11, 15, 19, 23];

    // Şu andan sonraki en yakın mum başlangıç saatini bul
    let hedefSaat = mumBaslangicSaatleri.find(h => h > saat);
    if (hedefSaat === undefined) {
        // eğer günün sonundaysak (örn: saat 23:30), ertesi günün ilk mum saati 3
        hedefSaat = 3;
        now.setDate(now.getDate() + 1); // ertesi gün
    }

    // Beklenecek zamanı hesapla
    let hedefZaman = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        hedefSaat, 0, 0, 0
    );

    let beklemeMs = hedefZaman - new Date();

    // console.log("Şimdi: " + new Date().toLocaleTimeString());
    // console.log("Bir sonraki mum: " + hedefZaman.toLocaleTimeString());
    // console.log("Beklenecek süre (dk): " + Math.floor(beklemeMs / 60000));

    let waitFor = delay => new Promise(resolve => setTimeout(resolve, delay));
    await waitFor(beklemeMs);
}

async function get_rsi_4h(coin_name) {
    let data_4h = await saat_get_data_4h(coin_name)
    let rsi_4h = null

    if(data_4h !== null){
        await saat_calculate_rsi_4h(data_4h)
        rsi_4h = parseFloat(parseFloat(data_4h[data_4h.length-1].rsi).toFixed(2))
        return rsi_4h;
    }else{
        return null
    }
}

async function rsi_dk_sinyali_bekle(coin_name, saatlik_sinyal_fiyati) {
    while (true) {
        await bekle_60sn();

        let data = await dk_calculate_indicators(coin_name);
        let rsi = data[data.length-2].rsi
        // let rsi_2 = data[data.length-3].rsi
        let lastPrice = data[data.length-2].close
        let degisim = (lastPrice-saatlik_sinyal_fiyati)/saatlik_sinyal_fiyati*100

        if(rsi<30 && lastPrice<saatlik_sinyal_fiyati){

            let bekleyen_coinler = await get_bekleyen_list("dakika_3()")
            if (!bekleyen_coinler.includes(coin_name) && bekleyen_coinler.length<max_alim) { //satılmayı bekleyen coinler arasında bu coin YOKSA;
                
                await long_marketBuy(coin_name, lastPrice);
                
                let tickSize = await find_tickSize_price(coin_name);
                let entryPrice = await get_entryPrice(coin_name);
                let quantity = await get_quantity(coin_name);
                let tp_price = parseFloat(entryPrice * 1.05).toFixed(tickSize); // %5 tp

                // TAKE PROFIT ORDER oluştur.
                await binance.futuresSell(coin_name, quantity, tp_price, { reduceOnly: true, timeInForce: "GTC" }); // TP: SATIŞ EMRİ

                // 1 tane %10 aşağıdan kademeli alım emri oluşturulacak.
                // let limit_price = parseFloat((entryPrice * 0.9).toFixed(tickSize));                        
                // await binance.futuresBuy(coin_name, quantity, limit_price, { timeInForce: 'GTX' });
                kademeli_alim_diz(coin_name, entryPrice);
                saatlik_takip(coin_name);
                console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - sinyal fiyatının %" + degisim.toFixed(2) + " aşağısından alım yapıldı.")

            }
            else{
                console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - satılmayı bekleyen coinler arasında olduğu için veya max alım sayısına ulaşıldığı için alım yapılmayacak. bekleyen_coinler: " + bekleyen_coinler.length)
            }

            return

        }
        else{
            console.log(new Date().toLocaleTimeString() + " - dakikalık rsi<30 bekleniyor... " + coin_name + " - DK_RSI: " + rsi.toFixed(2) + " - degisim: " + degisim.toFixed(2));
        }
        
    }
}

async function kademeli_alim_diz(coin_name, quantity) {
    let tickSize = await find_tickSize_price(coin_name);
    let entryPrice = await get_entryPrice(coin_name);
    // let stepSize = await find_stepSize_quantity(coin_name);

    let emirler_arasi_fiyat_araligi = parseFloat((entryPrice*profit_rate).toFixed(tickSize));
    // console.log(new Date().toLocaleTimeString() + " - emirler_arasi_fiyat_araligi: " + emirler_arasi_fiyat_araligi);

    //aşağıdan alım emirleri oluşturuluyor.
    for(let i=1;i<=kademeli_alim_sayisi;i++){
        let limit_order_fiyati = entryPrice-(i*emirler_arasi_fiyat_araligi);
        limit_buy_emri_with_profit_rate(coin_name, limit_order_fiyati, quantity);
    }
}

async function get_sum_avg_funding_fee() {
  try {
    const response = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex');
    const data = await response.json();

    const fundingRates = data
      .map(item => parseFloat(item.lastFundingRate))
      .filter(rate => !isNaN(rate));

    const totalFunding = fundingRates.reduce((acc, rate) => acc + rate, 0);
    const averageFunding = totalFunding / fundingRates.length;

    console.log(`Coin Sayısı: ${fundingRates.length} --- Toplam Funding Fee: ${totalFunding.toFixed(6)} (${(totalFunding * 100).toFixed(4)}%)`);
  } catch (error) {
    console.error("Hata:", error);
  }
}

async function dk_rsi_alarm(coin_name){
    await binance.futuresLeverage(coin_name, leverage).catch(err => console.log(new Date().toLocaleTimeString() + " -42err- " + err)); //kaldıraç
    await binance.futuresMarginType(coin_name, 'CROSSED')/*.then(json => console.log(json))*/.catch(err => console.log(new Date().toLocaleTimeString() + " -41err- " + err));
    let stepSize = await find_stepSize_quantity(coin_name);
    let margin = 10
    let alim_sayisi=0;

    while (true) {
        await bekle_60sn();
        let data = await dk_calculate_indicators(coin_name);
        let rsi = data[data.length-2].rsi
        let rsi_2 = data[data.length-3].rsi
        let lastPrice = data[data.length-2].close

        if(rsi_2<30 && rsi>30 && alim_sayisi<20){

            
            let bekleyen_coinler = await get_bekleyen_list("dakika_2()")
            if (bekleyen_coinler.includes(coin_name)) { //satılmayı bekleyen coinler arasında bu coin VARSA;
                // let breakEvenPrice = await get_breakEvenPrice(coin_name);
                let entryPrice = await get_entryPrice(coin_name);

                if(/*lastPrice>breakEvenPrice && */lastPrice>entryPrice){
                    console.log(new Date().toLocaleTimeString() + " - lastPrice>entryPrice olduğu için alım yapılmadı.")
                    continue;
                }
            }
            


            let y = margin * leverage / lastPrice
            let quantity = parseFloat(y.toFixed(stepSize))
            
            let json = await binance.futuresMarketBuy(coin_name, quantity)
            .catch(err => console.log(new Date().toLocaleTimeString() + ' - dakika long_marketBuy() içindeki futuresMarketBuy request hatası: ' + err))

            if (json.status == 'NEW' || json.status == "FILLED") { //futuresMarketBuy işlemi başarılı 
                alim_sayisi++
                console.log(new Date().toLocaleTimeString() + ' - alim_sayisi: ' + alim_sayisi + ' - ' + coin_name + ', ' + lastPrice + ' fiyatindan LONG BUY Market ORDER verildi. quantity: ' + quantity);
            }
            else if (json.code < 0) { //futuresMarketBuy işlemi başarısız
                console.log(new Date().toLocaleTimeString() + " - " + coin_name + ", futuresMarketBuy() işlemi yaparken HATA verdi => " + json.msg)
            }
        }
        else if(rsi>70){
            let bekleyen_coinler = await get_bekleyen_list("dakika()")
            if (bekleyen_coinler.includes(coin_name)) { //satılmayı bekleyen coinler arasında bu coin VARSA;
                let breakEvenPrice = await get_breakEvenPrice(coin_name);
                let entryPrice = await get_entryPrice(coin_name);

                if(lastPrice>breakEvenPrice && lastPrice>entryPrice){
                    let y = margin * leverage / lastPrice
                    let quantity = parseFloat(y.toFixed(stepSize))
                    await binance.futuresMarketSell(coin_name, quantity, { reduceOnly: true })
                    .then((json) => {

                        if (json.code < 0) { //futuresMarketSell işlemi başarısız
                            console.log(new Date().toLocaleTimeString() + " - " + coin_name + ", LONG MARKET SELL HATASI:  => " + json.msg);
                        }
                        else{
                            alim_sayisi--
                            console.log(new Date().toLocaleTimeString() + " - LONG Market SELL... Satılan Quantity: " + quantity + " - alim_sayisi: " + alim_sayisi);
                        }

                    })
                    .catch(err => console.log(new Date().toLocaleTimeString() + ' - long_marketSell() requestinde hata var: ' + err))
                }
                else{
                    console.log(new Date().toLocaleTimeString() + " - Satış yapılmadı. breakEvenPrice: " + breakEvenPrice + " - entryPrice: " + entryPrice + " - lastPrice: " + lastPrice);
                }
            }
            
            // open('D:\\worth.mp4')
        }
        else{
            console.log(coin_name + " - RSI: " + rsi.toFixed(2))
        }
    }
}

async function get_all_market_ranks() {
    try {
        // API isteğini yap
        const response = await axios.get('https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?limit=2000&sort_dir=desc', {
            headers: {
                'X-CMC_PRO_API_KEY': coin_market_cap_api_key,
            },
        });

        if (response.status !== 200) {
            console.log('API isteği başarısız oldu: ', response.status);
            return [];
        }

        const json = response.data;

        // Tüm coinlerin adını ve sıralamasını alın
        const ranks = json.data.map(coin => ({
            coin_name: coin.symbol+"USDT",
            rank: coin.cmc_rank,
        }));

        return ranks;

    } catch (error) {
        console.error('API isteği başarısız oldu (status code = 429 ise aylık request hakkı bitmiş demektir): ' + error);
        return [];
    }
}



async function mail_gonder_24_saat() {
    while(true){
        await bekle(60*60*24);

        let kazanc = mail_satis_sayisi * amount * profit_rate * leverage * 0.85; //komisyondan dolayı %15 kesinti için 0.85 ile çarpıyoruz.
    
        let konu = new Date().toLocaleTimeString() + " - GRID TRADING Günlük Sonuç";
        let mesaj = "Alım Sayısı: " + mail_alis_sayisi + "\nSatış Sayısı: " + mail_satis_sayisi + "\nTP Başına Profit Rate: %" + profit_rate*100 + "\nTahmini Kazanç: " + kazanc.toFixed(2);
        send_mail_cuneyt(konu, mesaj);
    
        mail_alis_sayisi = 0
        mail_satis_sayisi = 0
    }
}

async function tepe_fiyati_bul(coin_name){
    let data = await saat_calculate_indicators(coin_name);

    let price_list = []
    let rsi_70_bulundu = 0

    for(let i=data.length-3;i>2;i--){
        // ilk önce rsi>67 koşulunu buluyor daha sonra rsi<30 koşuluna kadar tüm high fiyatlardan en yükseğini alıyoruz.
        if(data[i]['rsi']>67){
            rsi_70_bulundu = 1
        }

        price_list.push(data[i]['high']);

        if(data[i-1]['rsi']<30 && data[i]['rsi']>30 && rsi_70_bulundu==1){
            break;
        }

    }

    tepe_fiyati = Math.max(...price_list);

    console.log(new Date().toLocaleTimeString() + " - tepe_fiyati: " + tepe_fiyati);

}

async function get_breakEvenPrice(symbol) {
    try {
        // Pozisyon bilgilerini çek
        const positions = await binance.futuresPositionRisk();
        let tickSize = await find_tickSize_price(symbol);

        // İlgili coin çifti için pozisyonu bul
        const position = positions.find(pos => pos.symbol === symbol);

        if (position.positionAmt == 0) {
            console.log('Açık pozisyon bulunamadı!');
            return 0;
        }
        else{
            return parseFloat(parseFloat(position.breakEvenPrice).toFixed(tickSize));
        }
    } catch (error) {
        console.error('Hata:', error);
    }
}


async function getMarginDetails() {
    try {
        const accountInfo = await binance.futuresAccount();
        return ((accountInfo.totalMaintMargin / accountInfo.totalMarginBalance) * 100)
    } catch (error) {
        console.error('Error fetching margin details:', error);
        return 0;
    }
}

// Bildirim gönder
function bildirimGonder(title, message, side) {
    let image_path = null

    if(side == "buy"){
        image_path = 'D:\\buy.png'
    }
    else if(side == "sell"){
        image_path = 'D:\\sell.png'
    }
    else{
        image_path = 'D:\\bildirim.png'
    }

    notifier.notify(
        {
            title: title,
            message: message,
            icon: image_path, // Resim dosyasının yolu
            sound: true,
            wait: false,
            appID: 'Grid Trading' // Uygulama adı
        },
        function (err, response) {
            if (err) console.error("Bildirim hatası:", err);
        }
    );
}

async function garbage_collector_baslat(){
    while (true) {
        await bekle_60dk();
        if(global.gc){
            global.gc();
        }
        else{
            console.log('Garbage collection not available. Set --expose-gc when launching Node.');
        }
    }
}

async function amount_hesapla(){
    let current_balance = await get_balance()
    let amount = parseFloat((current_balance/alinabilir_max_coin_sayisi/7).toFixed(2)) // 5: her coin en fazla %50 terste kalabilir.
    return amount;
}

async function checkInternetConnection() {
    try {
        const isAlive = await new Promise((resolve, reject) => {
            ping.sys.probe('www.google.com.tr', (isAlive) => {
                resolve(isAlive);
            });
        });
        return isAlive
        // if (isAlive) {
        //     // console.log('Internet bağlantısı var.');
        //     baslat();
        // } else {
        //     console.log('Internet bağlantısı yok.');
        // }
    } 
    catch (error) {
        console.error('checkInternetConnection() Hata:', error);
    }
}

async function get_volume_marketcap() {
    try {
        const response = await axios.get('https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?limit=' + limit + "&sort_dir=desc", {
            headers: {
                'X-CMC_PRO_API_KEY': coin_market_cap_api_key,
            },
        });

        if (response.status !== 200) {
            throw new Error('API isteği başarısız oldu: ' + response.status);
        }

        const json = response.data;
        let list = []
        // console.log('Alınan veri:', json);
        for(let i=0;i<json.data.length;i++){
            list.push({'coin_name':json.data[i].symbol, 'volume_24h': json.data[i].quote.USD.volume_24h, 'market_cap':json.data[i].quote.USD.market_cap,'volume_mcap_rate': json.data[i].quote.USD.volume_24h/json.data[i].quote.USD.market_cap})
            // console.log(json.data[i].symbol + "\t\t" + (json.data[i].quote.USD.volume_24h/json.data[i].quote.USD.market_cap).toFixed(2) + "\t\t\t" + json.data[i].cmc_rank + "\t\t\t" + json.data[i].quote.USD.volume_change_24h.toFixed(2) + "\t\t\t\t" + json.data[i].quote.USD.percent_change_24h.toFixed(2))
        }
        return list

        // Diğer işlemleri burada devam ettirin...
    } catch (error) {
        console.error('API isteği başarısız oldu:', error.message);
        throw error;
    }
}

async function get_btc_funding_rate() {
    let btc_funding_rate = await binance.futuresMarkPrice( "BTCUSDT" ).then(json => json.lastFundingRate*100)
    return btc_funding_rate
}

async function get_all_tickSize_stepSize() {//tek seferde tüm coinlerin tickSize değerini çekmek için kullanılacak.

    //ticksize bilgisi alınıyor.
    await binance.futuresExchangeInfo()
        .then(json => {

            for (let i = 0; i < json.symbols.length; i++) {

                let tickSize = null;
                let stepSize = null;
                
                //tickSize => quantity için kullanılacak.
                if (json.symbols[i].filters[0].tickSize.indexOf("1") == 0) {
                    tickSize = 0;
                } else {
                    tickSize = json.symbols[i].filters[0].tickSize.indexOf("1") - 1;
                }
                
                //stepSize => price için kullanılacak.
                if(json.symbols[i].filters[2].stepSize.indexOf("1") == 0) {
                    stepSize = 0;
                } else {
                    stepSize = json.symbols[i].filters[2].stepSize.indexOf("1") - 1;
                }

                tickSize_stepSize_list.push({'coin_name': json.symbols[i].symbol, 'tickSize': tickSize, 'stepSize': stepSize});

                //console.log(new Date().toLocaleTimeString() + " - " + i + " - coin_name: " + json.symbols[i].symbol + " - tickSize: " + tickSize + " - stepSize: " + stepSize);
                
            }
        })
        .catch(err => console.log(new Date().toLocaleTimeString() + " -1err- " + err));

}

async function find_tickSize_price(coin_name){ //bot başlarken çekilen tickSize verileri içinde arama yaparak daha hızlı sonuca ulaşabiliriz.
    for(let i=0; i<tickSize_stepSize_list.length; i++){
        if(tickSize_stepSize_list[i].coin_name == coin_name){
            return tickSize_stepSize_list[i].tickSize;
        }
    }
}

async function find_stepSize_quantity(coin_name){ //bot başlarken çekilen stepSize verileri içinde arama yaparak daha hızlı sonuca ulaşabiliriz.
    for(let i=0; i<tickSize_stepSize_list.length; i++){
        if(tickSize_stepSize_list[i].coin_name == coin_name){
            return tickSize_stepSize_list[i].stepSize;
        }
    }
}

async function btc_rsi() {
    
    //RSI HESAPLAMA İÇİN KULLANILAN DEĞİŞKENLER
    let rsi_period = 14;
    let gain = [], loss = [], change = [];
    let sum_gain = 0, sum_loss = 0, rsi = null;
    let rsi_list = [];
    let closePrice_list = [];
    let minPrice_list = [];
    let maxPrice_list = [];
    
    let nesne = [ //3 elemanlı bir dizi => her elemanı bir json verisi tutuyor.
        {'time': '1m', 'rsi': null},
        {'time': '15m', 'rsi': null},
        {'time': '1h', 'rsi': null},
    ];

    for(let i=0;i<nesne.length;i++){
        
        await binance.futuresCandles("BTCUSDT", nesne[i].time)
        .then(json => {
    
            //RSI hesaplamak için kullanılacak veriler
            for (let i = 1; i < rsi_period + 1; i++) {
                let change_price = (parseFloat(json[i][4]) - parseFloat(json[i - 1][4]))
                change.push(change_price);
                if (change_price >= 0) {
                    gain.push(change_price);
                    loss.push(0);
                    sum_gain += change_price;
                } else {
                    loss.push(change_price);
                    gain.push(0);
                    sum_loss -= change_price;
                }
    
            }
    
            let avg_gain = sum_gain / rsi_period;
            let avg_loss = sum_loss / rsi_period;
            let rs = avg_gain / avg_loss;
            rsi = 100 - (100 / (1 + rs));
            let gecici_list = [] //stokastik rsi %K ve %D hesaplamak için kullanılacak
    
    
            for (let i = rsi_period + 1; i < json.length - 1; i++) {
                let change_price = (parseFloat(json[i][4]) - parseFloat(json[i - 1][4]))
                if (change_price >= 0) {
                    avg_gain = ((avg_gain * (rsi_period - 1)) + change_price) / rsi_period;
                    avg_loss = ((avg_loss * (rsi_period - 1)) + 0) / rsi_period;
                } else {
                    avg_gain = ((avg_gain * (rsi_period - 1)) + 0) / rsi_period;
                    avg_loss = ((avg_loss * (rsi_period - 1)) - change_price) / rsi_period;
                }
                rs = avg_gain / avg_loss;
                rsi = 100 - (100 / (1 + rs));
                rsi_list.push(rsi);
                closePrice_list.push(json[i][4]);
                minPrice_list.push(json[i][3]);
                maxPrice_list.push(json[i][2]);
    
                if (i > json.length - 20) { //bu if koşulundakiler, stokastik rsi %K ve %D hesaplamak için kullanılacak
                    gecici_list.push(rsi);
                }
            }
    
        })

        nesne[i].rsi = parseFloat(rsi).toFixed(2);

    }
    

    return nesne;


}




async function calculate_adx(coin_name) {
    
    let data = [];
    let period = 14;
    
    await binance.futuresCandles(coin_name, '1h')
    .then(json => {
        for(let i=0;i<json.length;i++){
            data.push({
                'open_time': parseFloat(json[i][0]),
                'open_price': parseFloat(json[i][1]),
                'high_price': parseFloat(json[i][2]),
                'low_price': parseFloat(json[i][3]),
                'close_price': parseFloat(json[i][4]),
                'volume': parseFloat(json[i][5]),
                'close_time': parseFloat(json[i][6]),
                'true_range': null, //ATR hesaplamak için kullanılacak.
                'atr': null, 
                'high_prevHigh': null, //adx hesaplamada kullanılacak. High - Previous High
                'prevLow_low': null, //adx hesaplamada kullanılacak. Previous Low -  Low
                'positive_dx': null,
                'negative_dx': null,
                'smooth_positive_dx': null,
                'smooth_negative_dx': null,
                'positive_dmi': null,
                'negative_dmi': null,
                'dx': null,
                'adx': null,
            })
        }
    })

    //True Range Hesaplama BAŞI
    for(let i=1;i<data.length;i++){
        let high_low = data[i].high_price - data[i].low_price; 
        let high_prevClose = Math.abs(data[i].high_price - data[i-1].close_price);
        let low_prevClose = Math.abs(data[i].low_price - data[i-1].close_price);
        let true_range = Math.max(high_low, high_prevClose, low_prevClose);
        //console.log(high_low + ", \t" + high_prevClose + ", \t" + low_prevClose + " => \t" + true_range)
        data[i].true_range = true_range;


        //ADX hesaplamada kullanılacak veriler alttadır.
        data[i].high_prevHigh = data[i].high_price - data[i-1].high_price;
        data[i].prevLow_low = data[i-1].low_price - data[i].low_price;
        
        if(data[i].high_prevHigh > data[i].prevLow_low && data[i].high_prevHigh > 0)    data[i].positive_dx = data[i].high_prevHigh;
        else data[i].positive_dx = 0;

        if(data[i].prevLow_low > data[i].high_prevHigh && data[i].prevLow_low > 0)      data[i].negative_dx = data[i].prevLow_low;
        else data[i].negative_dx = 0;

    }
    //True Range Hesaplama SONU

    //ATR Hesaplama BAŞI
    let sum_true_range = 0;
    let sum_positive_dx = 0; //adx hesaplamada kullanılacak.
    let sum_negative_dx = 0; //adx hesaplamada kullanılacak.
    
    for(let i=0;i<period;i++){
        sum_true_range += data[i].true_range;
        sum_positive_dx += data[i].positive_dx; //adx hesaplamada kullanılacak.
        sum_negative_dx += data[i].negative_dx; //adx hesaplamada kullanılacak.
    }

    data[period-1].atr = sum_true_range/period;
    data[period-1].smooth_positive_dx = sum_positive_dx/period; //adx hesaplamada kullanılacak.
    data[period-1].smooth_negative_dx = sum_negative_dx/period; //adx hesaplamada kullanılacak.
    data[period-1].positive_dmi = data[period-1].smooth_positive_dx/data[period-1].atr*100; //adx hesaplamada kullanılacak.
    data[period-1].negative_dmi = data[period-1].smooth_negative_dx/data[period-1].atr*100; //adx hesaplamada kullanılacak.
    data[period-1].dx = Math.abs(data[period-1].positive_dmi-data[period-1].negative_dmi)/(data[period-1].positive_dmi+data[period-1].negative_dmi)*100; //adx hesaplamada kullanılacak.

    //ilk atr hesaplaması üstte periyot sayısına göre ortalama alınarak hesaplanıyor. Sonraki ATR değerleri yumuşatılarak alttaki gibi hesaplanıyor.
    for(let i=period;i<data.length;i++){
        data[i].atr = ((data[i-1].atr*(period-1))+data[i].true_range)/period;
        data[i].smooth_positive_dx = ((data[i-1].smooth_positive_dx*(period-1))+data[i].positive_dx)/period; //adx hesaplamada kullanılacak.
        data[i].smooth_negative_dx = ((data[i-1].smooth_negative_dx*(period-1))+data[i].negative_dx)/period; //adx hesaplamada kullanılacak.
        data[i].positive_dmi = data[i].smooth_positive_dx/data[i].atr*100; //adx hesaplamada kullanılacak.
        data[i].negative_dmi = data[i].smooth_negative_dx/data[i].atr*100; //adx hesaplamada kullanılacak.
        data[i].dx = Math.abs(data[i].positive_dmi-data[i].negative_dmi)/(data[i].positive_dmi+data[i].negative_dmi)*100; //adx hesaplamada kullanılacak.
    }
    //ATR Hesaplama SONU

    
    //ADX Hesaplama BAŞI
    let sum_dx = 0;
    for(let i=period-1;i<(2*period)-1;i++){
        sum_dx += data[i].dx;
    }
    data[(2*period)-2].adx = sum_dx/period;

    //ilk adx değeri önceki periyot(14) ortalaması alınır. Sonraki adx değerleri yumuşatılarak alttaki şekilde hesaplanır.
    for(let i=(2*period)-1;i<data.length;i++){
        data[i].adx = ((data[i-1].adx*(period-1))+data[i].dx)/period;
    }
    //ADX Hesaplama SONU
    
    return parseFloat(data[data.length-2].adx);
}














async function dk_calculate_indicators(coin_name){

    let data = await dk_get_data(coin_name)

    // if(data.length<500){
    //     return
    // }

    try {
        await dk_calculate_rsi(data);
        await dk_calculate_atr(data);  
    } 
    catch (error) {
        // console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - calculate_indicators() hata: " + error)
        return
    }

    return data

}


async function dk_get_data(coin_name){
    let data = []
    let durum = true;

    try {

        while (durum == true) {
            
            await binance.futuresCandles(coin_name, "1m", {limit:490})
            .then(json => {
                // if (!(json && json.length > 0)){
                //     console.log(new Date().toLocaleTimeString() + " - hata: " + coin_name + " - json tanımlı değil.")
                //     durum == false
                //     return
                // }

                if (new Date(json[json.length - 1][6]).getHours() == new Date().getHours() && new Date(json[json.length - 1][6]).getMinutes() == new Date().getMinutes()){
                    durum = false;
                    //json[json.length-1][1] = openPrice
                    //json[json.length-1][2] = maxPrice
                    //json[json.length-1][3] = minPrice
                    //json[json.length-1][4] = closePrice

                    for(let i=0;i<json.length;i++){
                        data.push({
                            'coin_name:': coin_name,
                            'open': parseFloat(json[i][1]), 
                            'high': parseFloat(json[i][2]), 
                            'low': parseFloat(json[i][3]), 
                            'close': parseFloat(json[i][4]), 
                            'volume': parseFloat(json[i][5]), 
                            'date': new Date(json[i][6]).toLocaleDateString(), 
                            'time': new Date(json[i][6]).toLocaleTimeString(),
                            'saat': new Date(json[i][6]).getHours()
                        })
                    }

                } 
                else {
                    // console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - " + new Date(json[json.length - 1][6]).getHours() + " == " + new Date().getHours() + ", " +  new Date(json[json.length - 1][6]).getMinutes() + " == " + (new Date().getMinutes() + 59))
                    durum = true;
                }   
            })

            if (durum == true) {
                await bekle(1);
            }

        }
    } 
    catch (error) {
        // console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - get_data() hata: " + error)
        return null
    }

    // console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - data.length: " + data.length)
    return data
}

async function dk_calculate_rsi(data){

    let rsi_period = 14

    for(let i=1;i<data.length;i++){
        
        if(data[i]['close']>data[i-1]['close']){
            data[i]['upward_movement']=data[i]['close']-data[i-1]['close']
            
        }
        else{
            data[i]['upward_movement']=0
        }

        if(data[i]['close']<data[i-1]['close']){
            data[i]['downward_movement']=data[i-1]['close']-data[i]['close']
        }
        else{
            data[i]['downward_movement']=0
        }
    }


    let sum_upward=0
    let sum_downward=0

    for(let i=rsi_period;i>0;i--){
        sum_upward += data[i]['upward_movement']
        sum_downward += data[i]['downward_movement']
    }

    data[rsi_period]['average_upward_movement']=sum_upward/rsi_period
    data[rsi_period]['average_downward_movement']=sum_downward/rsi_period
    data[rsi_period]['relative_strength']=data[rsi_period]['average_upward_movement']/data[rsi_period]['average_downward_movement']
    data[rsi_period]['rsi']=100-(100/(data[rsi_period]['relative_strength']+1))

    for(let i=rsi_period+1;i<data.length;i++){
        data[i]['average_upward_movement']=((data[i-1]['average_upward_movement']*(rsi_period-1))+data[i]['upward_movement'])/rsi_period
        data[i]['average_downward_movement']=((data[i-1]['average_downward_movement']*(rsi_period-1))+data[i]['downward_movement'])/rsi_period
    }

    for(let i=rsi_period+1;i<data.length;i++){
        data[i]['relative_strength']=data[i]['average_upward_movement']/data[i]['average_downward_movement']
    }

    for(let i=rsi_period+1;i<data.length;i++){
        data[i]['rsi']=100-(100/(data[i]['relative_strength']+1))
    }
    
}


async function dk_calculate_atr(data){
    //atr hesaplama başı
    let atr=null
    let atr_period=14
    let toplam_tr = 0;
    let first_tr = data[0]['high'] - data[0]['low']
    toplam_tr += first_tr;

    for (let i = 1; i < atr_period; i++) {
        let tr1 = data[0]['high'] - data[0]['low']
        let tr2 = Math.abs(data[i]['high'] - data[i-1]['close']);
        let tr3 = Math.abs(data[i]['low'] - data[i-1]['close'])
        let max_tr = Math.max(tr1, tr2, tr3);
        toplam_tr += max_tr;
    }

    atr = toplam_tr / atr_period; //14.satırdaki average true range değeri

    for (let i = atr_period; i < data.length; i++) {
        let tr1 = data[i]['high'] - data[i]['low'];
        let tr2 = Math.abs(data[i]['high'] - data[i-1]['close']);
        let tr3 = Math.abs(data[i]['low'] - data[i-1]['close'])
        let current_atr = Math.max(tr1, tr2, tr3);

        atr = ((atr * (atr_period - 1)) + current_atr) / atr_period;
        data[i]['atr'] = atr
        data[i]['atr_degisim'] = atr / data[i]['close'] * 100
    }
    //atr hesaplama sonu
}


async function saat_calculate_indicators(coin_name){
    let data = null

    try {

        data = await saat_get_data(coin_name);

        if(data.length<498){
            return //yeni coinleri al sat yapmıyoruz.
        }
    
        await saat_calculate_rsi(data);
        await saat_calculate_atr(data);
        // await saat_calculate_stokastik_rsi(data);
        // await saat_calculate_bollinger_band(data);

        


        
        
        let atr_degisim = parseFloat(data[data.length-2]['atr_degisim'])
        let rsi = parseFloat(data[data.length-2]['rsi'])
        let rsi_2 = parseFloat(data[data.length-3]['rsi'])
        let closePrice = parseFloat(data[data.length-2]['close'])

        

        let sum_atr = 0;
        let count_atr = 0;
        let veri_sayisi = data.length-1;

        for(let i=20;i<veri_sayisi;i++){
            sum_atr += parseFloat(data[i]['atr_degisim'])
            count_atr++
        }

        let avg_atr = sum_atr/count_atr;

        
        for(let i=veri_sayisi-48;i<veri_sayisi;i++){
            let degisim = (data[i]['close']-data[i]['open'])/data[i]['open']*100;
            if(degisim<-10){
                return null // 24 saat içinde herhangi bir mumda %10'dan fazla düşmüş bir coin ise tuhaflık var güvenli değil demektir. IGNORE THIS SH*T!
            }
        }
        
        coin_analiz.push({"coin_name": coin_name, "rsi": rsi, "rsi_2": rsi_2, "atr_degisim": atr_degisim, "closePrice": closePrice, "rank": null, "avg_atr": avg_atr})
        
        return data
    }
    catch (error) {
        // console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - calculate_indicators() hata: " + error)
        return null
    }
    finally{
        taranan_coin_sayisi++
    }

}
//

async function saat_get_data_4h(coin_name){
    let data = []
    let durum = true;
    /*
    //sadece 4 saatlik mumlar kapandığında çalışmasını istiyorsan alttaki if koşulunu kullanabilirsin.
    let saat = new Date().getHours();
    if(![3, 7, 11, 15, 19, 21].includes(saat)){ //saat 4'ün katları değil ise fonksiyon çalıştırılmayacak.
        return null
    }
    */

    try {

        while (durum == true) {
            
            await binance.futuresCandles(coin_name, "4h", {limit:500})
            .then(json => {
                // if (!(json && json.length > 0)){
                //     console.log(new Date().toLocaleTimeString() + " - hata: " + coin_name + " - json tanımlı değil.")
                //     durum == false
                //     return
                // }
                

                if (true){
                    durum = false;
                    //json[json.length-1][1] = openPrice
                    //json[json.length-1][2] = maxPrice
                    //json[json.length-1][3] = minPrice
                    //json[json.length-1][4] = closePrice

                    for(let i=0;i<json.length;i++){
                        data.push({
                            'coin_name': coin_name,
                            'open': parseFloat(json[i][1]), 
                            'high': parseFloat(json[i][2]), 
                            'low': parseFloat(json[i][3]), 
                            'close': parseFloat(json[i][4]), 
                            'volume': parseFloat(json[i][5]), 
                            'date': new Date(json[i][6]).toLocaleDateString(), 
                            'time': new Date(json[i][6]).toLocaleTimeString(),
                            'saat': new Date(json[i][6]).getHours()
                        })
                    }

                } 
                else {
                    // console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - " + new Date(json[json.length - 1][6]).getHours() + " == " + new Date().getHours() + ", " +  new Date(json[json.length - 1][6]).getMinutes() + " == " + (new Date().getMinutes() + 59))
                    durum = true;
                }   
            })

            if (durum == true) {
                await bekle(1);
            }

        }
    } 
    catch (error) {
        // console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - get_data() hata: " + error)
        return null
    }

    // console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - data.length: " + data.length)
    return data
}

async function saat_calculate_rsi_4h(data){

    let rsi_period = 14

    for(let i=1;i<data.length;i++){
        
        if(data[i]['close']>data[i-1]['close']){
            data[i]['upward_movement']=data[i]['close']-data[i-1]['close']
            
        }
        else{
            data[i]['upward_movement']=0
        }

        if(data[i]['close']<data[i-1]['close']){
            data[i]['downward_movement']=data[i-1]['close']-data[i]['close']
        }
        else{
            data[i]['downward_movement']=0
        }
    }


    let sum_upward=0
    let sum_downward=0

    for(let i=rsi_period;i>0;i--){
        sum_upward += data[i]['upward_movement']
        sum_downward += data[i]['downward_movement']
    }

    data[rsi_period]['average_upward_movement']=sum_upward/rsi_period
    data[rsi_period]['average_downward_movement']=sum_downward/rsi_period
    data[rsi_period]['relative_strength']=data[rsi_period]['average_upward_movement']/data[rsi_period]['average_downward_movement']
    data[rsi_period]['rsi']=100-(100/(data[rsi_period]['relative_strength']+1))

    for(let i=rsi_period+1;i<data.length;i++){
        data[i]['average_upward_movement']=((data[i-1]['average_upward_movement']*(rsi_period-1))+data[i]['upward_movement'])/rsi_period
        data[i]['average_downward_movement']=((data[i-1]['average_downward_movement']*(rsi_period-1))+data[i]['downward_movement'])/rsi_period
    }

    for(let i=rsi_period+1;i<data.length;i++){
        data[i]['relative_strength']=data[i]['average_upward_movement']/data[i]['average_downward_movement']
    }

    for(let i=rsi_period+1;i<data.length;i++){
        data[i]['rsi']=100-(100/(data[i]['relative_strength']+1))
    }
    
}

























//

async function saat_get_data(coin_name){
    let data = []
    let durum = true;

    try {

        while (durum == true) {
            
            await binance.futuresCandles(coin_name, "1h", {limit:500})
            .then(json => {
                // if (!(json && json.length > 0)){
                //     console.log(new Date().toLocaleTimeString() + " - hata: " + coin_name + " - json tanımlı değil.")
                //     durum == false
                //     return
                // }
                if (new Date(json[json.length - 1][6]).getHours() == new Date().getHours()){
                    durum = false;
                    //json[json.length-1][1] = openPrice
                    //json[json.length-1][2] = maxPrice
                    //json[json.length-1][3] = minPrice
                    //json[json.length-1][4] = closePrice

                    for(let i=0;i<json.length;i++){
                        data.push({
                            'coin_name': coin_name,
                            'open': parseFloat(json[i][1]), 
                            'high': parseFloat(json[i][2]), 
                            'low': parseFloat(json[i][3]), 
                            'close': parseFloat(json[i][4]), 
                            'volume': parseFloat(json[i][5]), 
                            'date': new Date(json[i][6]).toLocaleDateString(), 
                            'time': new Date(json[i][6]).toLocaleTimeString(),
                            'saat': new Date(json[i][6]).getHours()
                        })
                    }

                } 
                else {
                    // console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - " + new Date(json[json.length - 1][6]).getHours() + " == " + new Date().getHours() + ", " +  new Date(json[json.length - 1][6]).getMinutes() + " == " + (new Date().getMinutes() + 59))
                    durum = true;
                }   
            })

            if (durum == true) {
                await bekle(1);
            }

        }
    } 
    catch (error) {
        // console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - get_data() hata: " + error)
        return null
    }

    // console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - data.length: " + data.length)
    return data
}

async function saat_calculate_rsi(data){

    let rsi_period = 14

    for(let i=1;i<data.length;i++){
        
        if(data[i]['close']>data[i-1]['close']){
            data[i]['upward_movement']=data[i]['close']-data[i-1]['close']
            
        }
        else{
            data[i]['upward_movement']=0
        }

        if(data[i]['close']<data[i-1]['close']){
            data[i]['downward_movement']=data[i-1]['close']-data[i]['close']
        }
        else{
            data[i]['downward_movement']=0
        }
    }


    let sum_upward=0
    let sum_downward=0

    for(let i=rsi_period;i>0;i--){
        sum_upward += data[i]['upward_movement']
        sum_downward += data[i]['downward_movement']
    }

    data[rsi_period]['average_upward_movement']=sum_upward/rsi_period
    data[rsi_period]['average_downward_movement']=sum_downward/rsi_period
    data[rsi_period]['relative_strength']=data[rsi_period]['average_upward_movement']/data[rsi_period]['average_downward_movement']
    data[rsi_period]['rsi']=100-(100/(data[rsi_period]['relative_strength']+1))

    for(let i=rsi_period+1;i<data.length;i++){
        data[i]['average_upward_movement']=((data[i-1]['average_upward_movement']*(rsi_period-1))+data[i]['upward_movement'])/rsi_period
        data[i]['average_downward_movement']=((data[i-1]['average_downward_movement']*(rsi_period-1))+data[i]['downward_movement'])/rsi_period
    }

    for(let i=rsi_period+1;i<data.length;i++){
        data[i]['relative_strength']=data[i]['average_upward_movement']/data[i]['average_downward_movement']
    }

    for(let i=rsi_period+1;i<data.length;i++){
        data[i]['rsi']=100-(100/(data[i]['relative_strength']+1))
    }
    
}

async function saat_calculate_atr(data){
    //atr hesaplama başı
    let atr=null
    let atr_period=14
    let toplam_tr = 0;
    let first_tr = data[0]['high'] - data[0]['low']
    toplam_tr += first_tr;

    for (let i = 1; i < atr_period; i++) {
        let tr1 = data[0]['high'] - data[0]['low']
        let tr2 = Math.abs(data[i]['high'] - data[i-1]['close']);
        let tr3 = Math.abs(data[i]['low'] - data[i-1]['close'])
        let max_tr = Math.max(tr1, tr2, tr3);
        toplam_tr += max_tr;
    }

    atr = toplam_tr / atr_period; //14.satırdaki average true range değeri

    for (let i = atr_period; i < data.length; i++) {
        let tr1 = data[i]['high'] - data[i]['low'];
        let tr2 = Math.abs(data[i]['high'] - data[i-1]['close']);
        let tr3 = Math.abs(data[i]['low'] - data[i-1]['close'])
        let current_atr = Math.max(tr1, tr2, tr3);

        atr = ((atr * (atr_period - 1)) + current_atr) / atr_period;
        data[i]['atr'] = atr
        data[i]['atr_degisim'] = atr / data[i]['close'] * 100
    }
    //atr hesaplama sonu
}


async function saat_calculate_stokastik_rsi(data){
    let period = 14
    for(let i=period*2;i<data.length;i++){
        let rsi = []

        for(let j=0;j<period;j++){
            rsi.push(data[i-j]['rsi'])
        }

        let lowest_rsi = Math.min(...rsi)
        let highest_rsi = Math.max(...rsi)
        data[i]['stokastik'] = ((data[i]['rsi']-lowest_rsi)/(highest_rsi-lowest_rsi))*100
    }

    //stokastik %K altta hesaplanıyor.
    for(let i=(period*2)+3;i<data.length;i++){
        let sum=0
        for(let j=0;j<3;j++){
            sum += data[i-j]['stokastik']
        }
        data[i]['stokastik_k'] = sum/3
    }

    //stokastik %D altta hesaplanıyor.
    for(let i=(period*2)+6;i<data.length;i++){
        let sum=0
        for(let j=0;j<3;j++){
            sum += data[i-j]['stokastik_k']
        }
        data[i]['stokastik_d'] = sum/3
    }
}


async function saat_calculate_bollinger_band(data){
    let period = 200;
    let upper_muptiplier=2;
    let lower_muptiplier=2;

    for(let i=period-1;i<data.length;i++){
        let sum=0;
        for(let k=i;k>i-period;k--){
            sum += data[k]['close']
        }
        data[i]['bb_sma'] = sum/period
        


        //farklarının karesini topla
        let square_sum=0;
        for(let k=i;k>i-period;k--){
            square_sum += Math.pow(data[k]['close']-data[i]['bb_sma'],2)
        }

        data[i]['bb_standart_sapma'] = Math.sqrt(square_sum/(period))
        data[i]['bb_upper'] = data[i]['bb_sma'] + (data[i]['bb_standart_sapma']*upper_muptiplier)
        data[i]['bb_lower'] = data[i]['bb_sma'] - (data[i]['bb_standart_sapma']*lower_muptiplier)
        data[i]['bbw'] = (data[i]['close'] - data[i]['bb_lower']) / (data[i]['bb_upper'] - data[i]['bb_lower'])
        // console.log("lower: " + data[i]['bb_lower'] + " - upper: " + data[i]['bb_upper'])
    }

}

/////////////////////////////////////////günlük veri kodu başlangıcı
async function gunluk_calculate_indicators(coin_name){

    try {

        let data = await gunluk_get_data(coin_name);

        if(data.length<150){
            return 0; //yeni coinleri al sat yapmıyoruz.
        }
    
        await gunluk_calculate_rsi(data);

        for(let i=data.length-1;i>=0;i--){
            let rsi = parseFloat(data[i]['rsi']);
            if(rsi>80){
                return 0; //aşırı yükselmiş coin olduğu anlamına gelir, alım yapılmayacak.
            }
            else if(rsi<30){
                return 1; //alım yapılabilir demektir.
            }
        }

        return 1; //problem yok alım yapılabilir.
    }
    catch (error) {
        console.log(new Date().toLocaleTimeString() + " - gunluk_calculate_indicators() hata verdi.")
    }

}

async function gunluk_get_data(coin_name){
    let data = []

    try {

        await binance.futuresCandles(coin_name, "1d", {limit:500})
        .then(json => {
                //json[json.length-1][1] = openPrice
                //json[json.length-1][2] = maxPrice
                //json[json.length-1][3] = minPrice
                //json[json.length-1][4] = closePrice

                for(let i=0;i<json.length;i++){
                    data.push({
                        'coin_name': coin_name,
                        'open': parseFloat(json[i][1]), 
                        'high': parseFloat(json[i][2]), 
                        'low': parseFloat(json[i][3]), 
                        'close': parseFloat(json[i][4]), 
                        'volume': parseFloat(json[i][5]), 
                        'date': new Date(json[i][6]).toLocaleDateString(), 
                        'time': new Date(json[i][6]).toLocaleTimeString(),
                        'saat': new Date(json[i][6]).getHours()
                    })
                }

        })
        
    } 
    catch (error) {
        console.log(new Date().toLocaleTimeString() + " - gunluk_get_data() hata verdi.")
    }
    finally{
        return data
    }
    
}

async function gunluk_calculate_rsi(data){

    let rsi_period = 14

    for(let i=1;i<data.length;i++){
        
        if(data[i]['close']>data[i-1]['close']){
            data[i]['upward_movement']=data[i]['close']-data[i-1]['close']
            
        }
        else{
            data[i]['upward_movement']=0
        }

        if(data[i]['close']<data[i-1]['close']){
            data[i]['downward_movement']=data[i-1]['close']-data[i]['close']
        }
        else{
            data[i]['downward_movement']=0
        }
    }


    let sum_upward=0
    let sum_downward=0

    for(let i=rsi_period;i>0;i--){
        sum_upward += data[i]['upward_movement']
        sum_downward += data[i]['downward_movement']
    }

    data[rsi_period]['average_upward_movement']=sum_upward/rsi_period
    data[rsi_period]['average_downward_movement']=sum_downward/rsi_period
    data[rsi_period]['relative_strength']=data[rsi_period]['average_upward_movement']/data[rsi_period]['average_downward_movement']
    data[rsi_period]['rsi']=100-(100/(data[rsi_period]['relative_strength']+1))

    for(let i=rsi_period+1;i<data.length;i++){
        data[i]['average_upward_movement']=((data[i-1]['average_upward_movement']*(rsi_period-1))+data[i]['upward_movement'])/rsi_period
        data[i]['average_downward_movement']=((data[i-1]['average_downward_movement']*(rsi_period-1))+data[i]['downward_movement'])/rsi_period
    }

    for(let i=rsi_period+1;i<data.length;i++){
        data[i]['relative_strength']=data[i]['average_upward_movement']/data[i]['average_downward_movement']
    }

    for(let i=rsi_period+1;i<data.length;i++){
        data[i]['rsi']=100-(100/(data[i]['relative_strength']+1))
    }
    
}
/////////////////////////////////////////günlük veri kodu sonu


async function get_data(coin_name){
    let data = []
    let durum = true;

    try {

        while (durum == true) {
            
            await binance.futuresCandles(coin_name, "1h", {limit:490})
            .then(json => {
                // if (!(json && json.length > 0)){
                //     console.log(new Date().toLocaleTimeString() + " - hata: " + coin_name + " - json tanımlı değil.")
                //     durum == false
                //     return
                // }

                if (new Date(json[json.length - 1][6]).getHours() == new Date().getHours()){
                    durum = false;
                    //json[json.length-1][1] = openPrice
                    //json[json.length-1][2] = maxPrice
                    //json[json.length-1][3] = minPrice
                    //json[json.length-1][4] = closePrice

                    for(let i=0;i<json.length;i++){
                        data.push({
                            'coin_name:': coin_name,
                            'open': parseFloat(json[i][1]), 
                            'high': parseFloat(json[i][2]), 
                            'low': parseFloat(json[i][3]), 
                            'close': parseFloat(json[i][4]), 
                            'volume': parseFloat(json[i][5]), 
                            'date': new Date(json[i][6]).toLocaleDateString(), 
                            'time': new Date(json[i][6]).toLocaleTimeString(),
                            'saat': new Date(json[i][6]).getHours()
                        })
                    }

                } 
                else {
                    // console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - " + new Date(json[json.length - 1][6]).getHours() + " == " + new Date().getHours() + ", " +  new Date(json[json.length - 1][6]).getMinutes() + " == " + (new Date().getMinutes() + 59))
                    durum = true;
                }   
            })

            if (durum == true) {
                await bekle(1);
            }

        }
    } 
    catch (error) {
        // console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - get_data() hata: " + error)
        return null
    }

    // console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - data.length: " + data.length)
    return data
}

async function calculate_rsi(data){

    let rsi_period = 14

    for(let i=1;i<data.length;i++){
        
        if(data[i]['close']>data[i-1]['close']){
            data[i]['upward_movement']=data[i]['close']-data[i-1]['close']
            
        }
        else{
            data[i]['upward_movement']=0
        }

        if(data[i]['close']<data[i-1]['close']){
            data[i]['downward_movement']=data[i-1]['close']-data[i]['close']
        }
        else{
            data[i]['downward_movement']=0
        }
    }


    let sum_upward=0
    let sum_downward=0

    for(let i=rsi_period;i>0;i--){
        sum_upward += data[i]['upward_movement']
        sum_downward += data[i]['downward_movement']
    }

    data[rsi_period]['average_upward_movement']=sum_upward/rsi_period
    data[rsi_period]['average_downward_movement']=sum_downward/rsi_period
    data[rsi_period]['relative_strength']=data[rsi_period]['average_upward_movement']/data[rsi_period]['average_downward_movement']
    data[rsi_period]['rsi']=100-(100/(data[rsi_period]['relative_strength']+1))

    for(let i=rsi_period+1;i<data.length;i++){
        data[i]['average_upward_movement']=((data[i-1]['average_upward_movement']*(rsi_period-1))+data[i]['upward_movement'])/rsi_period
        data[i]['average_downward_movement']=((data[i-1]['average_downward_movement']*(rsi_period-1))+data[i]['downward_movement'])/rsi_period
    }

    for(let i=rsi_period+1;i<data.length;i++){
        data[i]['relative_strength']=data[i]['average_upward_movement']/data[i]['average_downward_movement']
    }

    for(let i=rsi_period+1;i<data.length;i++){
        data[i]['rsi']=100-(100/(data[i]['relative_strength']+1))
    }
    
}

async function calculate_stokastik_rsi(data){
    let period = 14
    for(let i=period*2;i<data.length;i++){
        let rsi = []

        for(let j=0;j<period;j++){
            rsi.push(data[i-j]['rsi'])
        }

        let lowest_rsi = Math.min(...rsi)
        let highest_rsi = Math.max(...rsi)
        data[i]['stokastik'] = ((data[i]['rsi']-lowest_rsi)/(highest_rsi-lowest_rsi))*100
    }

    //stokastik %K altta hesaplanıyor.
    for(let i=(period*2)+3;i<data.length;i++){
        let sum=0
        for(let j=0;j<3;j++){
            sum += data[i-j]['stokastik']
        }
        data[i]['stokastik_k'] = sum/3
    }

    //stokastik %D altta hesaplanıyor.
    for(let i=(period*2)+6;i<data.length;i++){
        let sum=0
        for(let j=0;j<3;j++){
            sum += data[i-j]['stokastik_k']
        }
        data[i]['stokastik_d'] = sum/3
    }
}

async function calculate_atr(data){
    //atr hesaplama başı
    let atr=null
    let atr_period=14
    let toplam_tr = 0;
    let first_tr = data[0]['high'] - data[0]['low']
    toplam_tr += first_tr;

    for (let i = 1; i < atr_period; i++) {
        let tr1 = data[0]['high'] - data[0]['low']
        let tr2 = Math.abs(data[i]['high'] - data[i-1]['close']);
        let tr3 = Math.abs(data[i]['low'] - data[i-1]['close'])
        let max_tr = Math.max(tr1, tr2, tr3);
        toplam_tr += max_tr;
    }

    atr = toplam_tr / atr_period; //14.satırdaki average true range değeri

    for (let i = atr_period; i < data.length; i++) {
        let tr1 = data[i]['high'] - data[i]['low'];
        let tr2 = Math.abs(data[i]['high'] - data[i-1]['close']);
        let tr3 = Math.abs(data[i]['low'] - data[i-1]['close'])
        let current_atr = Math.max(tr1, tr2, tr3);

        atr = ((atr * (atr_period - 1)) + current_atr) / atr_period;
        data[i]['atr'] = atr
        data[i]['atr_degisim'] = atr / data[i]['close'] * 100
    }
    //atr hesaplama sonu
}



async function hata_maili_gonder(hata) {
    let konu = new Date().toLocaleTimeString() + " CÜNEYT 1dk BOTU DURDU! Manuel Kontrol Edilecek.";
    let mesaj = hata;
    await send_mail_cuneyt(konu, mesaj);

    await bekle(3);
    process.exit(1);
}



async function get_tickSize(coin_name) {
    let tickSize = null;

    //ticksize bilgisi alınıyor.
    await binance.futuresExchangeInfo()
        .then(json => {
            for (let i = 0; i < json.symbols.length; i++) {
                if (json.symbols[i].symbol == coin_name) {
                    if (json.symbols[i].filters[0].tickSize.indexOf("1") == 0) {
                        tickSize = 0;
                    } else {
                        tickSize = json.symbols[i].filters[0].tickSize.indexOf("1") - 1;
                    }

                    break;
                }
            }
        })
        .catch(err => console.log(new Date().toLocaleTimeString() + " -1err- " + err));

    return tickSize;
}

async function get_stepSize(coin_name) {

    const coins = await binance.futuresExchangeInfo()
        .catch(err => console.log(new Date().toLocaleTimeString() + " -2err- " + err));

    let t = 0;
    for (t = 0; t < coins.symbols.length; t++) {
        if (coins.symbols[t].pair == coin_name) {
            break;
        }
    }

    const json = coins.symbols[t];
    let stepSize; //quantity için stepSize kullanılır.

    if (json.filters[2].stepSize.indexOf("1") == 0) {
        stepSize = 0;
    } else stepSize = json.filters[2].stepSize.indexOf("1") - 1;

    return stepSize;

}





async function saatlik_takip(coin_name){

    while (true) {
        await bekle_60dk();
        let bekleyen_coinler = await get_bekleyen_list("saatlik_takip()")
        if (bekleyen_coinler.includes(coin_name)) { //satılmayı bekleyen coinler arasında bu coin VARSA;
            
            //let data = await saat_calculate_indicators(coin_name);
            let data = await saat_get_data(coin_name);
            await saat_calculate_rsi(data);
            await saat_calculate_atr(data);

            if (data === null || typeof data === 'undefined' || data.length == 0) {
                console.log(new Date().toLocaleTimeString() + " - saatlik_takip() - " + coin_name + " - data yok")
                continue   
            }

            let breakEvenPrice = await get_breakEvenPrice(coin_name);
            let entryPrice = await get_entryPrice(coin_name);
            let rsi = data[data.length-2]['rsi']
            let closePrice = data[data.length-2]['close']
            let degisim = (closePrice-entryPrice)/entryPrice*100;
            let net_degisim = (closePrice-breakEvenPrice)/breakEvenPrice*100;

            //btc verileri
            let btc_data = await saat_calculate_indicators("BTCUSDT");
            let btc_rsi = parseFloat(btc_data[btc_data.length-2]['rsi']);

            
            
            
            if( rsi>67 || (rsi>50 && net_degisim>5) || (rsi>60 && net_degisim>0) || (btc_rsi>69 && net_degisim>-10) ){
                await cancel_all_orders(coin_name);
                await long_marketSell_order(coin_name);
                await bekle(10);
                
                // let realized_pnl = await get_realized_pnl(coin_name);
                
                let konu = new Date().toLocaleTimeString() + " - " + coin_name + " - satıldı.";
                let mesaj = "RSI: " + rsi.toFixed(2) + " - BTC_RSI: " + btc_rsi.toFixed(2) + " - Değişim: " + degisim.toFixed(2) + " - net_degisim: " + net_degisim.toFixed(2)
                send_mail_cuneyt(konu, mesaj);

                console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - " + mesaj);
                
                // process.exit()
                return
            }
            /*else{
                console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - saatlik takip raporu, RSI: " + rsi.toFixed(2) + " - degisim: " + degisim.toFixed(2) + " - net_degisim: " + net_degisim.toFixed(2) + " - BTC_RSI: " + btc_rsi.toFixed(2))
            }*/
            
        }
        else{
            await cancel_all_orders(coin_name);
            console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - saatlik_takip() - Bu coine ait açık pozisyon yok. Saatlik takip fonksiyonu sonlandırıldı.");
            await bekle(10)
            // process.exit()
            return
        }
        
    }

}

async function kademeli_long_buy_order(coin_name) { //adet parametresi gönderilmezse amount değerinin kendisi kadarlık alım yapılacak demektir.
    
    let leverage = await get_position_leverage(coin_name);
    await binance.futuresLeverage(coin_name, leverage).catch(err => console.log(new Date().toLocaleTimeString() + " -4223erra- " + err)); //kaldıraç
    //await binance.futuresMarginType(coin_name, 'ISOLATED').catch(err => console.log(new Date().toLocaleTimeString() + " -41err- " + err));
    var quantity = await get_quantity(coin_name);

    await binance.futuresMarketBuy(coin_name, quantity)
    .then((json) => {

        if (json.status == 'NEW') { //futuresMarketBuy işlemi başarılı 
            console.log(new Date().toLocaleTimeString() + ' - ' + (++buy_count) + ' - ' + coin_name + ' fiyatından KADEMELİ LONG BUY Market ORDER verildi. quantity: ' + quantity);
            cancelOrder_and_reOpenOrder(coin_name, "long"); //coin'e ait tüm açık emirleri iptal eder. Sonra takeProfit ve stopLoss emirlerini oluşturur.
        }
        else if (json.code < 0) { //futuresMarketBuy işlemi başarısız
            console.log(new Date().toLocaleTimeString() + " - " + coin_name + ", kademeli_long_buy_order, futuresMarketBuy() işlemi yaparken HATA verdi => " + json.msg)
        }

    })
    .catch(err => console.log(new Date().toLocaleTimeString() + ' - kademeli_long_buy_order() içindeki futuresMarketBuy request hatası: ' + err))
}

async function long_marketBuy(coin_name, lastPrice){
    let stepSize = await find_stepSize_quantity(coin_name);
    await binance.futuresLeverage(coin_name, leverage).catch(err => console.log(new Date().toLocaleTimeString() + " -42err- " + err)); //kaldıraç
    // await binance.futuresMarginType(coin_name, 'ISOLATED').catch(err => console.log(new Date().toLocaleTimeString() + " -41err- " + err));
    await binance.futuresMarginType(coin_name, 'CROSSED')/*.then(json => console.log(json))*/.catch(err => console.log(new Date().toLocaleTimeString() + " -41err- " + err));

    let y = amount * leverage / lastPrice
    var quantity = parseFloat(y.toFixed(stepSize))

    let json = await binance.futuresMarketBuy(coin_name, quantity)
    .catch(err => console.log(new Date().toLocaleTimeString() + ' - long_marketBuy() içindeki futuresMarketBuy request hatası: ' + err))

    if (json.status == 'NEW' || json.status == "FILLED") { //futuresMarketBuy işlemi başarılı 
        console.log(new Date().toLocaleTimeString() + ' - ' + (++buy_count) + ' - ' + coin_name + ', ' + lastPrice + ' fiyatindan LONG BUY Market ORDER verildi.');

        //Alım yapılan market fiyatına ulaşıyoruz ve %1 yukarısına tp emri koyuyoruz.
        /*let orderDetails = await binance.futuresOrderStatus(coin_name, { orderId: json.orderId });
        let buy_price = orderDetails.avgPrice
        long_sell_order(coin_name, buy_price, quantity)*/
    }
    else if (json.code < 0) { //futuresMarketBuy işlemi başarısız
        console.log(new Date().toLocaleTimeString() + " - " + coin_name + ", futuresMarketBuy() işlemi yaparken HATA verdi => " + json.msg)
    }

    return {
        "buy_order_id": json.orderId,
        "quantity": quantity,
    };
}

async function mail_olustur(side, bb, json){
    await bekle(50);
    let btc_data = await btc_rsi();
    //let btc_adx = await calculate_adx("BTCUSDT");
    //let hacim = await get_volume(bb.coin_name);
    let adx_diff = bb.adx_2-bb.adx;
    let rsi_diff = Math.abs(bb.rsi - bb.rsi_2);

    if(side == "short"){
        let konu = new Date().toLocaleTimeString() + " +1h CÜNEYT+ " + bb.coin_name + " + RSI SHORT";
        let mesaj = "RSI: " + parseFloat(bb.rsi).toFixed(2) + "\nATR DEĞİŞİM: " + bb.atr_degisim.toFixed(2) + "\nADX: " + parseFloat(bb.adx).toFixed(2) + "\nADX_2: " + parseFloat(bb.adx_2).toFixed(2) + "\nDegisim(%): " + parseFloat(bb.degisim).toFixed(2) + "\nStokastik %K: " + parseFloat(bb.stokastik_rsi).toFixed(2) + " \nSondan 2. Stokastik %K: " + parseFloat(bb.stokastik_rsi_2).toFixed(2) + " \nBB%B: " + bb.bb_yuzde.toFixed(2) + "\nMFI: " + bb.mfi + "\nWilliams %R: " + bb.williams_r + "\nBTC RSI 1m: " + btc_data[0].rsi + "\nBTC RSI 15m: " + btc_data[1].rsi + "\nBTC RSI 1h: " + btc_data[2].rsi + "\nSMA(200): " + bb.sma + "\nlastPrice: " + bb.closePrice;
        send_mail_cuneyt(konu, mesaj);
    }
    else if(side == "long"){
        let konu = new Date().toLocaleTimeString() + " +1h CÜNEYT+ " + bb.coin_name + " + RSI LONG";
        let mesaj = "RSI: " + parseFloat(bb.rsi).toFixed(2) + "\nATR DEĞİŞİM: " + bb.atr_degisim.toFixed(2) + "\nADX: " + parseFloat(bb.adx).toFixed(2) + "\nADX_2: " + parseFloat(bb.adx_2).toFixed(2) + "\nDegisim(%): " + parseFloat(bb.degisim).toFixed(2) + "\nStokastik %K: " + parseFloat(bb.stokastik_rsi).toFixed(2) + " \nSondan 2. Stokastik %K: " + parseFloat(bb.stokastik_rsi_2).toFixed(2) + " \nBB%B: " + bb.bb_yuzde.toFixed(2) + "\nMFI: " + bb.mfi + "\nWilliams %R: " + bb.williams_r + "\nBTC RSI 1m: " + btc_data[0].rsi + "\nBTC RSI 15m: " + btc_data[1].rsi + "\nBTC RSI 1h: " + btc_data[2].rsi + "\nSMA(200): " + bb.sma + "\nlastPrice: " + bb.closePrice;
        send_mail_cuneyt(konu, mesaj);
    }
    else{
        console.log(new Date().toLocaleTimeString() + " hatalı side gönderildi: " + side)
    }
}

async function get_volume(coin_name){ //ortalama hacim koşulu koymak için kullanılacak. 10.07.2023
    let sum_volume_3day = 0;
    let sum_volume_10day = 0;
    let sum_volume_30day = 0;
    let average_volume_3day = null;
    let average_volume_10day = null;
    let average_volume_30day = null;

    await binance.futuresCandles(coin_name, "1d")
    .then(json => {

        //sinyal geldiği mumu hesaba katmıyoruz. 3 günlük hacim ortalması
        for(let i=json.length-1-3; i<json.length-1; i++){
            sum_volume_3day += parseFloat(json[i][7]);
        }
        average_volume_3day = sum_volume_3day/3;

        //sinyal geldiği mumu hesaba katmıyoruz. 10 günlük hacim ortalması
        for(let i=json.length-1-10; i<json.length-1; i++){
            sum_volume_10day += parseFloat(json[i][7]);
        }
        average_volume_10day = sum_volume_10day/10;


        //sinyal geldiği mumu hesaba katmıyoruz. 30 günlük hacim ortalması
        for(let i=json.length-1-30; i<json.length-1; i++){
            sum_volume_30day += parseFloat(json[i][7]);
        }
        average_volume_30day = sum_volume_30day/30;

    }).catch(err => console.log(coin_name + " - get_volume() HATA: " + err))

    return{
        'ort_3gun': average_volume_3day,
        'ort_10gun': average_volume_10day,
        'ort_30gun': average_volume_30day,
        'oran_3_30': parseFloat(average_volume_3day / average_volume_30day * 100).toFixed(2),
        'oran_10_30': parseFloat(average_volume_10day / average_volume_30day * 100).toFixed(2),
    }
}

async function satildi_mi_takip(coin_name){
    while (true) {
        let bekleyen_coinler = await get_bekleyen_list("satildi_mi_takip fonksiyonu");
        if (!bekleyen_coinler.includes(coin_name)) {
            let profit = await get_profit();
            console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - satıldı. " + profit);
            await cancel_all_orders(coin_name);
            return;
        }
        else{
            await bekle(35);
        }
    }
}

async function long_limit_sell_order(coin_name) { //giriş fiyatına limit order oluşturur.
    let quantity = await get_quantity(coin_name);
    let tickSize = null;

    let entryPrice = await get_entryPrice(coin_name);

    //ticksize bilgisi alınıyor.
    await binance.futuresExchangeInfo()
        .then(json => {
            for (let i = 0; i < json.symbols.length; i++) {
                if (json.symbols[i].symbol == coin_name) {
                    if (json.symbols[i].filters[0].tickSize.indexOf("1") == 0) {
                        tickSize = 0;
                    } else {
                        tickSize = json.symbols[i].filters[0].tickSize.indexOf("1") - 1;
                    }

                    break;
                }
            }
        })
        .catch(err => console.log(new Date().toLocaleTimeString() + " -3err- " + err));

    //TAKE PROFIT ORDER veriyoruz.
    await binance.futuresSell(coin_name, quantity, entryPrice, { reduceOnly: true, 'recvWindow': 10000000 })
        .then(json => {

            if (json.status == 'NEW') { //futuresMarketSell işlemi başarılı 
                console.log(new Date().toLocaleTimeString() + ' - ' + coin_name + ', ' + entryPrice + " fiyatindan LONG SELL ORDER(entryPrice) verildi.");

            }
            else if (json.code < 0) { //futuresMarketSell işlemi başarısız
                console.log(new Date().toLocaleTimeString() + " - " + coin_name + ", long_limit_sell_order() işlemi yaparken HATA verdi => " + json.msg + " - quantity: " + quantity + " - entryPrice: " + entryPrice);
            }

        })
        .catch(err => console.log(new Date().toLocaleTimeString() + " -4err- " + err));
}

async function short_limit_sell_order(coin_name) { //giriş fiyatına limit order oluşturur.
    let quantity = await get_quantity(coin_name);
    let tickSize = null;

    let entryPrice = await get_entryPrice(coin_name);

    await binance.futuresExchangeInfo()
        .then(json => {
            for (let i = 0; i < json.symbols.length; i++) {
                if (json.symbols[i].symbol == coin_name) {
                    if (json.symbols[i].filters[0].tickSize.indexOf("1") == 0) {
                        tickSize = 0;
                    } else {
                        tickSize = json.symbols[i].filters[0].tickSize.indexOf("1") - 1;
                    }

                    break;
                }
            }
        })
        .catch(err => console.log(new Date().toLocaleTimeString() + " -5err- " + err));


    //TAKE PROFIT değerini giriyoruz.
    await binance.futuresBuy(coin_name, quantity, entryPrice, { reduceOnly: true, 'recvWindow': 10000000 })
        .then((json) => {

            if (json.status == 'NEW') { //futuresBuy işlemi başarılı 
                console.log(new Date().toLocaleTimeString() + ' - ' + coin_name + ', ' + entryPrice + " fiyatından SHORT SELL ORDER(entryPrice) verildi.");

            }
            else if (json.code < 0) { //futuresBuy işlemi başarısız
                console.log(new Date().toLocaleTimeString() + " - " + coin_name + ", short_sell_order() işlemi yaparken HATA verdi => " + json.msg + " - quantity: " + quantity + " - entryPrice: " + entryPrice);
            }

        })
        .catch(err => console.log(new Date().toLocaleTimeString() + " -6err- " + err));
}





/*async function coin_arr_guncelle(coin_name, adet, kademeli_alim_sayisi) {
    coin_arr.map(item => {
        if (item.coin_name == coin_name) {
            item.adet = adet;
            item.kademeli_alim_sayisi = kademeli_alim_sayisi;

            if (item.kademeli_alim_sayisi > 1) {
                console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - yeni kademeli alım sayısı: " + item.kademeli_alim_sayisi)
            }
        }
    })
}*/

async function coin_arr_guncelle(coin_name, adet, kademeli_alim_sayisi) {
    coin_arr.map(item => {
        if (item.coin_name == coin_name) {
			if (kademeli_alim_sayisi > item.kademeli_alim_sayisi && kademeli_alim_sayisi > 1) {
                console.log(new Date().toLocaleTimeString() + " - " + coin_name + " " + kademeli_alim_sayisi + ". kez kademeli alım yapıldı.");
            }
			
            item.adet = adet;
            item.kademeli_alim_sayisi = kademeli_alim_sayisi;
        }
    })
}




async function coin_arr_bul(coin_name) {
    let coin = null;

    while (true) {
        coin_arr.map(item => {
            if (item.coin_name == coin_name) {
                coin = item;
            }
        })

        if (coin != null) {
            return coin;
        }
        else {
            console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - coin_arr_bul() fonksiyonunda null döndürdüğü için tekrar deneyecek.");
            await bekle(1);
        }
    }
}

async function short_marketSell_order(coin_name) { //short pozisyondaki order için market fiyatına satan fonksiyon
    let guncel_quantity = await get_quantity(coin_name);

    await binance.futuresMarketBuy(coin_name, guncel_quantity, { reduceOnly: true })
        .then((json) => {

            if (json.status == 'NEW') { //futuresMarketSell işlemi başarılı 
                console.log(new Date().toLocaleTimeString() + ' - ' + coin_name + ', market fiyatına satıldı.');
            }
            else if (json.code < 0) { //futuresMarketSell işlemi başarısız
                console.log(new Date().toLocaleTimeString() + " - " + coin_name + ", SHORT MARKET SELL HATASI:  => " + json.msg);
            }

        })
        .catch(err => console.log(new Date().toLocaleTimeString() + ' - short_marketSell_order() requestinde hata var: ' + err))
}

async function long_marketSell_order(coin_name) { //short pozisyondaki order için market fiyatına satan fonksiyon
    let guncel_quantity = await get_quantity(coin_name);

    if(guncel_quantity>0){
        await binance.futuresMarketSell(coin_name, guncel_quantity, { reduceOnly: true })
        .then((json) => {

            if (json.status == 'NEW') { //futuresMarketSell işlemi başarılı 
                console.log(new Date().toLocaleTimeString() + ' - ' + coin_name + ', market fiyatına satıldı.');
            }
            else if (json.code < 0) { //futuresMarketSell işlemi başarısız
                console.log(new Date().toLocaleTimeString() + " - " + coin_name + ", long_marketSell_order --- LONG MARKET SELL HATASI:  => " + json.msg + " - quantity: " + guncel_quantity);
            }

        })
        .catch(err => console.log(new Date().toLocaleTimeString() + ' - long_marketSell_order() requestinde hata var: ' + err))
    }
}

async function get_likitPrice(coin_name) {
    let likit_price = await binance.futuresPositionRisk()
        .then(json => {
            for (let i = 0; i < json.length; i++) {
                if (json[i].symbol == coin_name) {
                    return parseFloat(json[i].liquidationPrice);
                }
            }
        })
        .catch(err => console.log(new Date().toLocaleTimeString() + " - " + coin_name + ", likit price çekerken hata: " + err));

    return likit_price;
}

async function get_degisim(coin_name) {
    let durum = true;
    let degisim = null;

    while (durum == true) {

        degisim = await binance.futuresCandles(coin_name, "1h")
            .then(json => {
                //json[json.length-1][1] = openPrice
                //json[json.length-1][2] = maxPrice
                //json[json.length-1][3] = minPrice
                //json[json.length-1][4] = closePrice

                //yeni mum aktif olup olmadığını anlamak için json.length-1 saatini kontrol ediyoruz.
                if (new Date(json[json.length - 1][6]).getHours() == new Date().getHours() && new Date(json[json.length - 1][6]).getMinutes() == (new Date().getMinutes() + 59)) {
                    durum = false;

                    let openPrice = parseFloat(json[json.length - 2][1]);
                    let closePrice = parseFloat(json[json.length - 2][4]);
                    let degisim = (closePrice - openPrice) / openPrice * 100;
                    return degisim;

                } else {
                    durum = true;
                }

            })
            .catch(err => {
                if (err == "promiseRequest error #403") {
                    console.log(new Date().toLocaleTimeString() + " - err2: " + coin_name + " - period: " + uzunluk + " - hata: " + err)
                    hata_maili_gonder(err);
                }
            })

        if (durum == true) {
            await bekle(1);
        }
    }

    return parseFloat(degisim).toFixed(2);
}



async function entryPrice_likitPrice_distance(coin_name) {
    let entryPrice = await get_entryPrice(coin_name);

    let likit_price = await binance.futuresPositionRisk()
        .then(json => {
            for (let i = 0; i < json.length; i++) {
                if (json[i].symbol == coin_name) {
                    return parseFloat(json[i].liquidationPrice);
                }
            }
        })
        .catch(err => console.log(new Date().toLocaleTimeString() + " - " + coin_name + ", likit price çekerken hata: " + err));

    let distance = (Math.abs(likit_price - entryPrice)) / entryPrice * 100;
    //price.degisim = (price.close-price.open)/price.open*100;

    console.log(new Date().toLocaleTimeString() + " - likitPrice noktasına yaklaştığında ortalama düşürmek için alım yapıldı. " + coin_name + " - entryPrice ile likitPrice arasındaki uzaklık(%): " + distance);
}

async function get_position_leverage(coin_name){ //istenen coin için aktif kaldıraç değerini döndürür.

    let aktif_kaldirac = await binance.futuresPositionRisk()
    .then(json => {
        for (let i = 0; i < json.length; i++) {
            if (json[i].symbol == coin_name) {
                return json[i].leverage;
            }
        }
    })

    return aktif_kaldirac;
}


async function get_bekleyen_list(nereden_cagrildi) {
    let bekleyen_coinler = [];

    try {
        // Binance API çağrısı
        let json = await binance.futuresPositionRisk()
    
        // Gelen veriyi işleme
        if (json && json.length > 0) {
            for (let i = 0; i < json.length; i++) {
                if (json[i].positionAmt != 0 && json[i].symbol != "PAXGUSDT") { // PAXGUSDT hariç diğer alınmış coinleri bekleyen_coinler dizisine ekliyoruz.
                    bekleyen_coinler.push(json[i].symbol)
                }
            }
        } else {
            console.log("Veri alınamadı veya boş döndü.");
        }
    } catch (error) {
        // Hata durumunda burası çalışır
        console.error("get_bekleyen_list() - Hata oluştu: ", error);
        console.log(new Date().toLocaleTimeString() + " - HATAYA SEBEP OLAN YER => " + nereden_cagrildi)
    }

    return bekleyen_coinler;
}


async function yeni_get_bekleyen_list(coin_name, nereden_cagrildi) {
    let bekleyen_coinler = [];

    await binance.futuresPositionRisk({ symbol: coin_name })
    .then(json => {
        if (json.code == -1003) {
            let ban_time = new Date(parseInt(json.msg.split(". ")[0].split(" ")[7])).toLocaleTimeString();
            console.log(json.msg)
            console.log(new Date().toLocaleTimeString() + " - get_bekleyen_list() futuresPositionRisk request hatası verdi. ban kaldırılma zamanı: " + ban_time);
            console.log(new Date().toLocaleTimeString() + " - HATAYA SEBEP OLAN YER => " + nereden_cagrildi)
            hata_maili_gonder(json.msg);
        }

        for (let i = 0; i < json.length; i++) {
            if (json[i].positionAmt != 0) {
                bekleyen_coinler.push(json[i].symbol)
            }
        }
    })

    return bekleyen_coinler;
}


async function coin_satilmayi_bekliyor(coin_name) { //parametre olaran gelen coin, satılmayı bekliyor mu diye kontrol ediliyor.

    return (await binance.futuresPositionRisk({ symbol: coin_name })
        .then(json => {
            if (json.code == -1003) {
                let ban_time = new Date(parseInt(json.msg.split(". ")[0].split(" ")[7])).toLocaleTimeString();
                console.log(json.msg)
                console.log(new Date().toLocaleTimeString() + " -------------- coin_satilmayi_bekliyor() futuresPositionRisk request hatası verdi. ban kaldırılma zamanı: " + ban_time);
                return;
            }

            if (json[0].positionAmt == 0) {
                return true //true: coin satılmayı bekliyor demektir.
            }
            else {
                return false //false: coin satıldı demektir.
            }
        }))
}

async function get_alinan_miktar(coin_name) {
    let alinan_miktar = await binance.futuresPositionRisk()
        .then(json => {
            for (let i = 0; i < json.length; i++) {
                if (json[i].symbol == coin_name) {
                    return json[i].isolatedWallet;
                }
            }
        })
    return alinan_miktar;
}

async function get_unRealizedProfit(coin_name) {

    let kar_zarar = await binance.futuresPositionRisk()
        .then(json => {
            for (let i = 0; i < json.length; i++) {
                if (json[i].symbol == coin_name) {
                    return json[i].unRealizedProfit;
                }
            }
        })
    return kar_zarar;
}


async function get_lastPrice(coin_name) {
    let durum = true;
    let lastPrice = null;

    while (durum == true) {

        await binance.futuresCandles(coin_name, "1h")
        .then(json => {
            //json[json.length-1][1] = openPrice
            //json[json.length-1][2] = maxPrice
            //json[json.length-1][3] = minPrice
            //json[json.length-1][4] = closePrice

            //yeni mum aktif ise önceki mumun kapanış fiyatını alıyoruz.
            if(new Date(json[json.length - 1][6]).getHours() == new Date().getHours() && new Date(json[json.length - 1][6]).getMinutes() == (new Date().getMinutes() + 59)){
                durum = false;
                lastPrice = parseFloat(json[json.length - 2][4]);
            }

        })
        .catch(err => console.log(new Date().toLocaleTimeString() + " -7err- " + err));

    }


    return lastPrice;
}
























async function onceki_bollinger(coin_name) {
    let uzunluk = 20, standart_sapma = 2;
    let sum = 0, avg = 0, price = [], diff = [], variance = 0;


    await binance.futuresCandles(coin_name, "1h")
        .then(json => {
            //json[json.length-1][1] = openPrice
            //json[json.length-1][2] = maxPrice
            //json[json.length-1][3] = minPrice
            //json[json.length-1][4] = closePrice

            for (let i = json.length - 1 - (uzunluk); i < json.length - 1; i++) {
                sum += parseFloat(json[i][4]);
                price.push(parseFloat(json[i][4]));
            }

            avg = sum / uzunluk;

        })
        .catch(err => { console.log(err); hata_maili_gonder(err); });

    for (let i = 0; i < price.length; i++) {
        diff.push(Math.pow((price[i] - avg), 2));
    }

    let toplam = 0;
    for (let i = 0; i < diff.length; i++) {
        toplam += diff[i];
    }
    variance = toplam / uzunluk;

    let sonuc = Math.sqrt(variance);
    let upper = (avg + (standart_sapma * sonuc));
    let lower = (avg - (standart_sapma * sonuc));

    return {
        'mid': parseFloat(avg.toFixed(6)),
        'upper': parseFloat(upper.toFixed(6)),
        'lower': parseFloat(lower.toFixed(6))
    }
}


async function onceki_lastPrice(coin_name) {
    let lastPrice = null;

    await binance.futuresCandles(coin_name, "1h")
        .then(json => {
            //json[json.length-1][1] = openPrice
            //json[json.length-1][2] = maxPrice
            //json[json.length-1][3] = minPrice
            //json[json.length-1][4] = closePrice


            lastPrice = parseFloat(json[json.length - 2][4]);
        })
        .catch(err => console.log(new Date().toLocaleTimeString() + " -8err- " + err));

    return lastPrice;
}

async function bekle(saniye) {
    const waitFor = delay => new Promise(resolve => setTimeout(resolve, delay));
    await waitFor(saniye * 1000);
}

async function bekle_5dk() {
    let kalan_dk = 4 - (new Date().getMinutes() % 5)
    let kalan_sn = 60 - new Date().getSeconds()
    //console.log(new Date().toLocaleTimeString() + " - Program, " + kalan_dk + "dk - "+kalan_sn+"sn sonra başlayacak.")

    let minute = kalan_dk * 1000 * 60;
    let second = kalan_sn * 1000;

    let waitFor = delay => new Promise(resolve => setTimeout(resolve, delay));
    await waitFor(minute + second);
}

async function bekle_15dk() {
    let kalan_dk = 14 - (new Date().getMinutes() % 15)
    let kalan_sn = 60 - new Date().getSeconds()
    //console.log(new Date().toLocaleTimeString() + " - Program, " + kalan_dk + "dk - "+kalan_sn+"sn sonra başlayacak.")

    let minute = kalan_dk * 1000 * 60;
    let second = kalan_sn * 1000;

    let waitFor = delay => new Promise(resolve => setTimeout(resolve, delay));
    await waitFor(minute + second);
}

async function bekle_60dk() {
    let kalan_dk = 59 - new Date().getMinutes()
    let kalan_sn = 60 - new Date().getSeconds()
    //console.log(new Date().toLocaleTimeString() + " - Program, " + kalan_dk + "dk - "+kalan_sn+"sn sonra başlayacak.")

    let minute = kalan_dk * 1000 * 60;
    let second = kalan_sn * 1000;

    let waitFor = delay => new Promise(resolve => setTimeout(resolve, delay));
    await waitFor(minute + second);
}

async function yeniden_baslat_60dk() {
    let kalan_dk = 59 - new Date().getMinutes()
    let kalan_sn = 60 - new Date().getSeconds()
    //console.log(new Date().toLocaleTimeString() + " - Program, " + kalan_dk + "dk - "+kalan_sn+"sn sonra başlayacak.")

    let minute = (kalan_dk-15) * 1000 * 60;
    let second = kalan_sn * 1000;

    let waitFor = delay => new Promise(resolve => setTimeout(resolve, delay));
    await waitFor(minute + second);
}

async function bekle_60sn() {
    let kalan_sn = 60 - new Date().getSeconds()

    let second = kalan_sn * 1000;
    let waitFor = delay => new Promise(resolve => setTimeout(resolve, delay));
    await waitFor(second);
}

async function long_kademeli_alim_emri_olustur(coin_name,quantity,buyPrice){ //%10 düştüğünde kademeli alım yapabilmek için limit emri oluşturan fonksiyon.
    let tickSize = await find_tickSize_price(coin_name);
    
    await binance.futuresBuy(coin_name, quantity, parseFloat(buyPrice).toFixed(tickSize))
    .then(json => {

        if (json.status == 'NEW') { //long limit satış emri başarıyla oluşturuldu.
            console.log(new Date().toLocaleTimeString() + ' - Kademeli limit emri oluşturma BAŞARILI: ' + coin_name + " - buyPrice: " + buyPrice + " - quantity: " + quantity);
        }
        else if (json.code < 0) { //long limit satış emri oluşturulamadı.
            console.log(new Date().toLocaleTimeString() + " - Kademeli limit emri oluşturma BAŞARISIZ: " + coin_name + " - buyPrice: " + buyPrice + " - quantity: " + quantity);
            console.log(json)
        }

    })
    .catch(err => console.log(new Date().toLocaleTimeString() + " -10err- " + err));
}

async function long_sell_order(coin_name, price, quantity){

    let tickSize = await find_tickSize_price(coin_name);
    let takeProfit = parseFloat(price).toFixed(tickSize);

    //TAKE PROFIT ORDER veriyoruz.
    // const order = await binance.futuresSell(coin_name, quantity, takeProfit, { timeInForce: 'GTX' });
    const order = await binance.futuresSell(coin_name, quantity, takeProfit, { reduceOnly: true, timeInForce: "GTC" });

    if (order.status === 'NEW') {
        // console.log(new Date().toLocaleTimeString() + ' - ' + coin_name + ', ' + takeProfit + " fiyatindan LONG SELL ORDER (takeProfit) oluşturuldu. long_sell_order() Quantity: " + quantity);
        tp_order_id_list.push({"order_id":order.orderId, "tp_price":takeProfit, "price":price})
    }
    else if (order.code < 0) {
        //long_sell_order(coin_name, takeProfit, quantity) //%1 tp oluşturma başarısız olursa %2 tp emri koymayı deneyecek.
        console.log(new Date().toLocaleTimeString() + " - " + coin_name + ", long_sell_order() işlemi yaparken HATA (market fiyatına satılacak quantity kadarı): " + order.msg + " - quantity: " + quantity + " - takeProfit: " + takeProfit);
        // await long_marketSell(coin_name, quantity)
    }

}

async function long_marketSell(coin_name) { //anlık fiyatı çekip market fiyatına satmak için
    // let lastPrice = await binance.futuresCandles(coin_name, "1d", { limit: 10 }).then(json => parseFloat(json[json.length - 1][4])).catch(err => console.log(new Date().toLocaleTimeString() + " -44err- " + err));
    // let stepSize = await find_stepSize_quantity(coin_name);
    let quantity = await get_quantity(coin_name);

    if(quantity>0){
        let json = await binance.futuresMarketSell(coin_name, quantity, { reduceOnly: true })
        .then((json) => {

            if (json.code < 0) { //futuresMarketSell işlemi başarısız
                console.log(new Date().toLocaleTimeString() + " - " + coin_name + ", LONG MARKET SELL HATASI:  => " + json.msg);
            }
            else{
                console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - LONG Market SELL");
            }
            return json

        })
        .catch(err => console.log(new Date().toLocaleTimeString() + ' - long_marketSell() requestinde hata var: ' + err))

        return json.orderId
    }
    else{
        null
    }
    
}


async function short_sell_order(coin_name) {
    let quantity = await get_quantity(coin_name);
    let tickSize = await get_tickSize(coin_name);
    let entryPrice = await get_entryPrice(coin_name);
    let takeProfit = entryPrice * (1 - profit_rate); //kar yüzdesi (takeProfit)
    // let stopLoss = entryPrice + (atr*atr_kat)

    //TAKE PROFIT değerini giriyoruz.
    await binance.futuresBuy(coin_name, quantity, takeProfit.toFixed(tickSize), { reduceOnly: true })
    .then((json) => {

        if (json.status == 'NEW') { //futuresBuy işlemi başarılı 
            console.log(new Date().toLocaleTimeString() + ' - ' + coin_name + ', ' + takeProfit.toFixed(tickSize) + " fiyatından SHORT SELL ORDER(takeProfit) oluşturuldu.");
        }
        else if (json.code < 0) { //futuresBuy işlemi başarısız
            console.log(new Date().toLocaleTimeString() + " - " + coin_name + ", short_sell_order() işlemi yaparken HATA verdi => " + json.msg + " - quantity: " + quantity + " - entryPrice: " + entryPrice + " - takeProfit: " + takeProfit.toFixed(tickSize));
            console.log(json)
        }

    })
    .catch(err => console.log(new Date().toLocaleTimeString() + " -12err- " + err));



    //STOP LOSS değerini giriyoruz.
    // await binance.futuresMarketBuy( coin_name, quantity, {reduceOnly: true, stopPrice: parseFloat(stopLoss).toFixed(tickSize), type:'STOP_MARKET'} )
    // .then((json) => {
    //     console.log(new Date().toLocaleTimeString() + ' - ' + coin_name + ', ' + parseFloat(stopLoss).toFixed(tickSize) +  " fiyatından SHORT(stopLoss) verildi.");
    //     // console.log(json)
    // })
    // .catch(err => console.log(new Date().toLocaleTimeString() + ' - stopLoss requestinde hata var: ' + err))






    //TRAILING STOP LOSS değerini giriyoruz. NOT: düzgün çalışmıyor.
    /*await binance.futuresMarketBuy( coin_name, quantity, {reduceOnly: true, callbackRate: 1, type:'TRAILING_STOP_MARKET'} )
    .then((json)=> {
        console.log(new Date().toLocaleTimeString() + ' - ' + coin_name + ', SHORT TRAILING STOP LOSS ORDER verildi.');
    })
    .catch(err => console.log(new Date().toLocaleTimeString() + ' - short stopLoss requestinde hata var: ' + err))*/

}


async function cancelOrder_and_reOpenOrder(coin_name, orderType) {
    //parametre olarak gelen coine ait "stopLoss, takeProfit, Buy, Sell vb." açık olan tüm emirler iptal edilir ve orderType(long veya short) değerine göre satış emri verilir.

    let orderId = [];

    //açık olan emirleri iptal edebilmek için "orderId" bilgisine ihtiyacımız var.
    //açık emirlerin orderId listesi alınıyor.
    await binance.futuresOpenOrders(coin_name)
        .then(json => {
            for (let i = 0; i < json.length; i++) {
                //console.log(i + " - " + coin_name + " - orderID: " + json[i].orderId)
                orderId.push(json[i].orderId);
            }
        })

    //orderId kullanılarak ilgili coine ait tüm açık emirler iptal ediliyor.
    for (let i = 0; i < orderId.length; i++) {
        await cancel_buy_order(coin_name, orderId[i]);
    }


    if (orderType == "long") {
        long_sell_order(coin_name); //long buy yapıldıysa takeProfit için long sell işlemi yapılmalıdır.
    }
    else if (orderType == "short") {
        short_sell_order(coin_name); //short buy yapıldıysa takeProfit için short sell işlemi yapılmalıdır.
    }
    else {
        console.log(new Date().toLocaleTimeString() + ' - Geçersiz orderType girildi. Parametre olarak girilen orderType değerini kontrol et!: orderType: ' + orderType);
    }





}















async function cancel_buy_order(coin_name, coin_orderId) {
    let str_order_id = coin_orderId.toString(); //futuresOrderStatus ve futuresCancel fonksiyonları string veri tipinde order id kabul ediyor.

    await binance.futuresOrderStatus(coin_name, { orderId: str_order_id })
        .then(json => {
            if (json.status == 'NEW') {
                binance.futuresCancel(coin_name, { orderId: str_order_id })
            }
            else if (json.code < 0) { //futuresMarketSell işlemi başarısız
                console.log(new Date().toLocaleTimeString() + " - " + coin_name + ", iptal ederken HATA verdi => " + json.msg);
            }
        }).catch(err => console.log(new Date().toLocaleTimeString() + " -13err- " + err));
}

async function cancel_all_orders(coin_name) {
    let orderId = [];

    //açık olan emirleri iptal edebilmek için "orderId" bilgisine ihtiyacımız var.
    //açık emirlerin orderId listesi alınıyor.
    await binance.futuresOpenOrders(coin_name)
        .then(json => {
            for (let i = 0; i < json.length; i++) {
                //console.log(i + " - " + coin_name + " - orderID: " + json[i].orderId)
                orderId.push(json[i].orderId);
            }
        })

    //orderId kullanılarak ilgili coine ait tüm açık emirler iptal ediliyor.
    for (let i = 0; i < orderId.length; i++) {
        // await cancel_buy_order(coin_name, orderId[i]);
        cancel_buy_order(coin_name, orderId[i]);
    }
}



async function get_entryPrice(coin_name) {
    let entryPrice = null;
    let counter = 0;

    while (counter<10) {
        entryPrice = await binance.futuresPositionRisk({ symbol: coin_name })
            .then(json => parseFloat(json[0].entryPrice));

        if (entryPrice != 0) {
            return entryPrice;
        } else {
            counter++
            await bekle(1);
        }
    }

}



async function get_balance() { //kullanılabilir bakiyeyi return eder.
    let balance = await binance.futuresAccount()
        .then(json => {
            return parseFloat(json.availableBalance)
        })
        .catch(err => { console.log(new Date().toLocaleTimeString() + ' - get_balance() fonksiyonu içinde, bakiye kontrol edilirken hata: ' + err) });
    return parseFloat(balance).toFixed(2);
}

async function get_total_balance() { //kullanılabilir bakiyeyi return eder.
    let balance = await binance.futuresAccount()
        .then(json => {
            return parseFloat(json.totalCrossWalletBalance)
        })
        .catch(err => { console.log(new Date().toLocaleTimeString() + ' - get_balance() fonksiyonu içinde, bakiye kontrol edilirken hata: ' + err) });
    return parseFloat(balance).toFixed(2);
}



async function get_leverage(coin_name) {
    return await binance.futuresLeverageBracket(coin_name).then(json => {
        return json[0]["brackets"][0].initialLeverage;
        //console.log(new Date().toLocaleTimeString() + ' - ' + coin_name + " - " + max_leverage)
    }).catch((err) => {
        console.log(new Date().toLocaleTimeString() + ' - ' + coin_name + " - hata: " + err);
        //console.log(err)
        //get_leverage(coin_name)
    })
}

async function max_leverage(coin_name) {
    let max_lev = await binance.futuresLeverageBracket(coin_name)
        .then(json =>json[0]["brackets"][0].initialLeverage)
        .catch((err) => console.log("max_leverage() hata: " + coin_name + " - " + err))
    
    return max_lev;
}

async function set_leverage(coin_name, new_leverage) {
    try {

        await binance.futuresLeverage(coin_name, new_leverage)
            .then(json => {
                console.log(new Date().toLocaleTimeString() + " - set_leverage() ataması yaparken JSON; ")
                console.log(json)

                if (json.code == -4028) {
                    return max_leverage(coin_name);
                }
            })
            .then(max_leverage => {
                set_leverage(coin_name, max_leverage);
            })
            .catch(err => console.log(new Date().toLocaleTimeString() + " -40err- " + err));

    } catch (error) {
        console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - set_leverage() içindeki try catch bloğuna takıldı. HATA: " + error);
        await bekle(2);
        set_leverage(coin_name, new_leverage);
    }
}

async function devam(coin_name) {

    await tepe_fiyati_bul(coin_name);
    let entryPrice = await get_entryPrice(coin_name);
    /*
    let entryPrice = null
    let bekleyen_coinler = await get_bekleyen_list("saatlik_takip()")
    
    if (bekleyen_coinler.includes(coin_name)) { //satılmayı bekleyen coinler arasında bu coin VARSA;
        entryPrice = await get_entryPrice(coin_name); //rsi sinyali geldiğinde başladığı durum için bu satırı aktif et.
        // entryPrice = await binance.futuresCandles(coin_name, "1d", { limit: 10 }).then(json => parseFloat(json[json.length - 1][4])).catch(err => console.log(new Date().toLocaleTimeString() + " -45err- " + err)); //elektrik gittiğinde bu satırı aktif et.
    }
    else{ // YOKSA
        let lastPrice = await binance.futuresCandles(coin_name, "1d", { limit: 10 }).then(json => parseFloat(json[json.length - 1][4])).catch(err => console.log(new Date().toLocaleTimeString() + " -44err- " + err));
        ilk_sinyal_zamani = new Date().getTime();
        await long_marketBuy(coin_name, lastPrice);

        //market fiyatından alım yaptıktan sonra giriş fiyatını çekerek emirler dizilecek.
        entryPrice = await get_entryPrice(coin_name);
        
    }
    */

    let tickSize = await find_tickSize_price(coin_name);
    let stepSize = await find_stepSize_quantity(coin_name);

    emirler_arasi_fiyat_araligi = parseFloat((tepe_fiyati*profit_rate).toFixed(tickSize));
    console.log(new Date().toLocaleTimeString() + " - emirler_arasi_fiyat_araligi: " + emirler_arasi_fiyat_araligi);

    //aşağıdan alım emirleri oluşturuluyor.
    for(let i=1;i<=kademeli_alim_sayisi;i++){
        let limit_order_fiyati = entryPrice-(i*emirler_arasi_fiyat_araligi);
        if(limit_order_fiyati<0){ //hata vermemesi için negatif fiyat kontrolü yapıyoruz.
            console.log(i + ". limit emrinden itibaren negatif fiyatlara emir koyulamıyor. kademeli_alim_sayisi: " + kademeli_alim_sayisi);
            break;
        }
        limit_buy_emri_with_profit_rate(coin_name, limit_order_fiyati);
    }

    while (buy_order_id_list.length<kademeli_alim_sayisi) {
        await bekle(0.5)
    }

    // Listeyi buy_price'a göre küçükten büyüğe sıralama
    buy_order_id_list.sort(function(a, b) {
        return a.buy_price - b.buy_price; // buy_price küçükten büyüğe sıralanır
    });




    //////////////////////////////////////////////////////////////////////////////////////////////////
    //BOT BAŞLATILDIĞINDA YUKARIDAN SATIŞ EMRİ KOYMAK İSTİYORSAN ALTTAKİ FOR DÖNGÜSÜNÜ KULLANABİLİRSİN.
    
    // for(let i=0;i<yukaridan_satis_emri_sayisi;i++){
    
    for(let i=0;i<sell_order_sayisi;i++){ //40 tane amount kadar alım yapılacak olup, sadece 5 tanesinin yukarıya satış emri koyulacak.
        let limit_sell_order_fiyati = entryPrice+(i*emirler_arasi_fiyat_araligi);
        let y = amount * leverage / limit_sell_order_fiyati;
        let quantity = parseFloat(y.toFixed(stepSize));
        // console.log(i+ " - limit_sell_order_fiyati: " + limit_sell_order_fiyati + " - quantity: " + quantity);
        await long_sell_order(coin_name, limit_sell_order_fiyati, quantity); //yukarıya tp emri oluşturan fonksiyon.
    }

    // TP Listesini price değerine göre büyükten küçüğe sıralama
    tp_order_id_list.sort(function(a, b) {
        return b.price - a.price; // price büyükten küçüğe sıralanır
    });


    console.log(new Date().toLocaleTimeString() + " - aşağı ve yukarı emirler oluşturuldu. Limit Buy Emir Sayısı: " + buy_order_id_list.length + " - kademeli alım sayısı: " + kademeli_alim_sayisi + " - tp_order_id_list: " + tp_order_id_list.length)
 
    // tp_emri_takip(coin_name)
    // buy_limit_order_takip(coin_name)
}

//bot başladığında kademeli alım sayısına göre aşağıya limit buy emirleri hızlıca async await kullanmadan hızlıca oluşturmak için bu fonksiyonu oluşturdum. 16.11.2024
async function limit_buy_emri_with_profit_rate(coin_name, price, quantity){ //parametre ile verilen profit_rate=kar_orani'na göre aşağıya limit buy emri oluşturmak için kullanılacak fonksiyon.
    try {
        
        let tickSize = await find_tickSize_price(coin_name);
        // let stepSize = await find_stepSize_quantity(coin_name);
        let limit_price = parseFloat(price.toFixed(tickSize));
        // var y = amount * leverage * (yeni_kaldirac-1) / kademeli_alim_sayisi / limit_price
        // var quantity = parseFloat(y.toFixed(stepSize))

        // 1. Limit Alış Emri Oluşturma
        // const limitOrder = await binance.futuresBuy(coin_name, quantity, limit_price, { type: 'LIMIT' }); //önceki
        const limitOrder = await binance.futuresBuy(coin_name, quantity, limit_price, { timeInForce: 'GTX' }); //code: -5022 hatasından dolayı chatgpt çözümü

        // Emrin gerçekleşip gerçekleşmediğini kontrol et
        if (limitOrder && limitOrder.orderId) {
            // console.log(coin_name + ' - Limit emri oluşturuldu: ' + limit_price);
            return
        }
        else {
            // open('D:\\horoz_alarm.mp4');
            console.log(new Date().toLocaleTimeString() + " - limit_buy_emri_with_profit_rate() fonksiyonunda hata verdi. limit_price: " + limit_price)
            console.log(limitOrder)
        }

    } catch (error) {
        console.error('Error placing orders: ', error.body || error);
    }
}

async function buy_limit_order_takip(coin_name) { // %1 aşağıya koyulan limit emirin gerçekleşip gerçekleşmediğini kontrol ettiriyoruz.
    
    // Limit emrinin durumunu izleme
    while (true) {
        try{
            // if(trading_status == 0){
            //     console.log(new Date().toLocaleTimeString() + " - buy_limit_order_takip() - trading kapalı.")
            //     return
            // }

            if(buy_order_id_list.length == 0){
                /*console.log(new Date().toLocaleTimeString() + " - aşağıda limit buy order kalmadığı için buy_limit_order_takip() fonksiyonu sonlandırıldı.")
                return*/
                await bekle(1)
                continue
            }

            const orderStatus = await binance.futuresOrderStatus(coin_name, { orderId:buy_order_id_list[buy_order_id_list.length-1]["order_id"] });
            if (orderStatus.status === 'FILLED') {
                // open('D:\\worth.mp4');
                // console.log(new Date().toLocaleTimeString() + " - gerçekleşen buy order id: " + buy_order_id_list[buy_order_id_list.length-1]["order_id"] + " - buy_price: " + buy_order_id_list[buy_order_id_list.length-1]["buy_price"] + " - buy quantity: " + buy_order_id_list[buy_order_id_list.length-1]["buy_quantity"])
                long_sell_order(coin_name, buy_order_id_list[buy_order_id_list.length-1]["buy_price"], buy_order_id_list[buy_order_id_list.length-1]["buy_quantity"]) //%1 tp emri oluşturur
                
                // let gerceklesen_buy_limit_fiyati = buy_order_id_list[buy_order_id_list.length-1]["buy_price"]
                // console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - Kademeli alım yapıldı (limit emir gerçekleşti). limit_price: " + buy_order_id_list[buy_order_id_list.length-1]["buy_price"])
                
                buy_order_id_list.splice(buy_order_id_list.length-1, 1);
                
                // Listeyi buy_price'a göre küçükten büyüğe sıralama
                buy_order_id_list.sort(function(a, b) {
                    return a.buy_price - b.buy_price; // buy_price küçükten büyüğe sıralanır
                });

                buy_limit_order_takip_bilgi_yazdir(coin_name);
                
            }
        }
        catch (err) {
            console.log(new Date().toLocaleTimeString() + " - buy_limit_order_takip() Hata: limit buy order takibi sırasında bir hata oluştu: " + err);
        }

        await bekle(0.05)
    }
}

async function tp_emri_takip(coin_name) {
    //tp emri oluşturulduktan sonra order_id listesindeki son id 5 saniye aralıklarla kontrol edilecek while sonsuz döngüsüne sokulacak.
    while(true){
        try {
            // if(trading_status == 0){
            //     console.log(new Date().toLocaleTimeString() + " - tp_emri_takip() - trading kapalı.")
            //     return
            // }


            // if(tp_order_id_list.length == 0){
            //     console.log(new Date().toLocaleTimeString() + " - yukarıda tp order kalmadığı için tp_emri_takip() fonksiyonu sonlandırıldı.")
            //     return
            // }

            
            if(tp_order_id_list.length == 0){ //tp emri kalmadı ise fonksiyonu 1sn aralıklarla çalıştırmaya devam ediyoruz çünkü daha sonra buy limit order gerçekleştiğinde tp emri oluşturulacaktır.
                await bekle(1)
                continue
            }

            const orderStatus = await binance.futuresOrderStatus(coin_name, { orderId: tp_order_id_list[tp_order_id_list.length-1]["order_id"] });
            if (orderStatus.status === 'FILLED') {
                // console.log(new Date().toLocaleTimeString() + ' - ' + coin_name + ' take profit emri gerçekleşti! - Gerçekleşen order_id: ' + tp_order_id_list[tp_order_id_list.length-1]["order_id"] + ' - Gerçekleşen tp fiyatı: ' + tp_order_id_list[tp_order_id_list.length-1]["tp_price"]);
                let onceki_limit_fiyati = parseFloat(tp_order_id_list[tp_order_id_list.length-1]["price"])
                
                // tp_order_id_list.pop()
                tp_order_id_list.splice(tp_order_id_list.length-1, 1);
                await limit_buy_emri_with_profit_rate(coin_name, onceki_limit_fiyati);
                //await direkt_limit_buy_emri(coin_name, onceki_limit_fiyati);

                /*while (buy_order_id_list.length>kademeli_alim_sayisi) {
                    let silinecek_order_id = buy_order_id_list[0]
                    //orderId kullanılarak coine ait olan açık emir iptal ediliyor.
                    await cancel_buy_order(coin_name, silinecek_order_id);

                    //iptal edilen buy limit order Array'den siliniyor.
                    let emir_silinmeden_once = buy_order_id_list.length
                    buy_order_id_list.splice(0,1)
                    let emir_silindikten_sonra = buy_order_id_list.length
                    console.log(new Date().toLocaleTimeString() + " - tp gerçekleştikten sonra, buy limit emirlerinden en sondakini siliyoruz. emir_silinmeden_once: " + emir_silinmeden_once + " - emir_silindikten_sonra: " + emir_silindikten_sonra)
                }*/

                // Listeyi buy_price'a göre küçükten büyüğe sıralama
                buy_order_id_list.sort(function(a, b) {
                    return a.buy_price - b.buy_price; // buy_price küçükten büyüğe sıralanır
                });


                tp_emri_takip_bilgi_yazdir(coin_name);

                //BOT SONLANDIRMA KOŞULU
                // if(tp_order_id_list.length == 0){
                //     await cancel_all_orders(coin_name);
                //     console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - Bu coine ait TP emri kalmadığı için grid trading botu görevini tamamladı.");

                //     start_bot();
                //     // trading_status = 0 //trading kapalı
                //     return;
                // }
            }
        }
        catch (err) {
            console.log(new Date().toLocaleTimeString() + " - tp_emri_takip() Hata: TP order takibi sırasında bir hata oluştu: " + err);
        }

        await bekle(0.05)


    }
}

async function buy_limit_order_takip_bilgi_yazdir(coin_name){
    mail_alis_sayisi++
    local_alis_sayisi++
    alis_sayisi++
    let realized_pnl = await get_realized_pnl(coin_name);

    let margin_ratio = await getMarginDetails();

    let bildirim_baslik = coin_name + " aşağıdan alındı";
    let bildirim_mesaj = "al: " + (local_alis_sayisi) + ", sat: " + (local_satis_sayisi)+"\nPNL: " + realized_pnl.toFixed(2)
    bildirimGonder(bildirim_baslik, bildirim_mesaj, "buy");
    // send_mail_cuneyt(new Date().toLocaleTimeString() + " - " + bildirim_baslik, bildirim_mesaj+"\nBekleyen TP Order: " + tp_order_id_list.length)

    console.log(new Date().toLocaleTimeString() + " - AL: " + (alis_sayisi) + ", sat: " + (satis_sayisi) + " - satılmayı bekleyen: " + (alis_sayisi-satis_sayisi) + " - Margin Ratio: " + margin_ratio.toFixed(4))
}

async function tp_emri_takip_bilgi_yazdir(coin_name){
    mail_satis_sayisi++
    local_satis_sayisi++
    satis_sayisi++
    let realized_pnl = await get_realized_pnl(coin_name);

    let bildirim_baslik = coin_name + " yukardan satıldı";
    let bildirim_mesaj = "al: " + (local_alis_sayisi) + ", sat: " + (local_satis_sayisi)+ "\nPNL: " + realized_pnl.toFixed(2)
    
    bildirimGonder(bildirim_baslik, bildirim_mesaj,"sell");
    // send_mail_cuneyt(new Date().toLocaleTimeString() + " - " + bildirim_baslik, bildirim_mesaj+"\nBekleyen TP Order: " + tp_order_id_list.length)

    console.log(new Date().toLocaleTimeString() + " - al: " + (alis_sayisi) + ", SAT: " + (satis_sayisi) + " - satılmayı bekleyen: " + (alis_sayisi-satis_sayisi) + " - Realized PNL: " + realized_pnl.toFixed(2))
}

async function get_realized_pnl(coin_name) { //ilk_sinyal_zamani=new Date(2025, 3, 2, 0, 0, 0).getTime()
    let total_income = 0;
    let hasMoreData = true;
    let startTime = ilk_sinyal_zamani;
    let endTime = Date.now(); // Şu anki zaman

    while (hasMoreData) {
        try {
            let income = await binance.futuresIncome({
                symbol: coin_name,
                startTime: startTime,
                endTime: endTime,
                limit: 1000
            });

            // API çağrısının başarılı olup olmadığını kontrol et
            if (!income || income.length === 0) {
                console.log("API'den veri gelmedi veya tüm veriler çekildi.");
                break;
            }

            // 25 Mart 2025 sonrası işlemleri filtrele (Tüm incomeType değerleri dahil)
            let filteredData = income.filter(item => item.time >= ilk_sinyal_zamani);

            // Eğer hiç işlem yoksa, uyarı ver
            if (filteredData.length === 0) {
                console.log("gelir/gider işlemi bulunamadı.");
            }

            // Toplam gelir/gideri hesapla
            total_income += filteredData.reduce((acc, item) => acc + parseFloat(item.income), 0);

            // console.log(`Çekilen veri sayısı: ${income.length}, Toplam PNL: ${total_income}`);

            // Eğer dönen veri 1000'den azsa, daha fazla veri yoktur
            if (income.length < 1000) {
                hasMoreData = false;
            } else {
                // Yeni başlangıç zamanı olarak en eski işlemin zamanını al
                startTime = income[income.length - 1].time + 1;
            }
        } catch (error) {
            console.error("API isteğinde hata:", error);
            break;
        }
    }

    // console.log(`Toplam PNL: ${total_income}`);

    return total_income;
}

async function direkt_limit_buy_emri(coin_name, limit_price) {
    try {
        
        let tickSize = await find_tickSize_price(coin_name);
        let stepSize = await find_stepSize_quantity(coin_name);
        limit_price = limit_price.toFixed(tickSize)

        var y = amount * leverage / limit_price
        var quantity = parseFloat(y.toFixed(stepSize))

        // 1. Limit Alış Emri Oluşturma
        const limitOrder = await binance.futuresBuy(coin_name, quantity, limit_price, { type: 'LIMIT' });

        // Emrin gerçekleşip gerçekleşmediğini kontrol et
        if (limitOrder && limitOrder.orderId) {
            // console.log(coin_name + ' - ESKİ LİMİT BUY EMRİ TEKRAR OLUŞTURULDU: ' + limit_price + " - order_status: " + limitOrder.status);
            buy_order_id_list.push({"order_id":limitOrder.orderId, "buy_price":limit_price, "buy_quantity":quantity})
        }
        else {

            // open('D:\\horoz_alarm.mp4');
            console.log(new Date().toLocaleTimeString() + " - direkt limit emri oluşturulamadı hata var, direkt_limit_buy_emri() fonksiyonunu kontrol et HATA::: ")
            console.log(limitOrder)
            return

        }

        

    } catch (error) {
        console.error('Error placing orders:', error.body || error);
    }
}

async function limit_buy_emri(coin_name, price) {
    try {
        
        let tickSize = await find_tickSize_price(coin_name);
        let stepSize = await find_stepSize_quantity(coin_name);
        let limit_price = (price*(1-profit_rate)).toFixed(tickSize)

        // console.log()
        // console.log(new Date().toLocaleTimeString() + " YENİ LİMİT BUY EMRİ OLUŞTURULACAK. - price: " + price + " - limit_price: " + limit_price)

        var y = amount * leverage / limit_price
        var quantity = parseFloat(y.toFixed(stepSize))

        //aynı limit emri fiyatı array'de varsa tekrar limit emir oluşturulmayacak. fonksiyonu sonlandır.
        for(let i=0;i<buy_order_id_list.length;i++){
            //limit price * 1.002 ile limit price * 0.998 arasında ise çok yakın fiyata daha önce limit emir koyulmuş demektir. Tekrar limit buy emri oluşturulmayacak.
            if(buy_order_id_list[i].buy_price > limit_price*0.998 && buy_order_id_list[i].buy_price < limit_price*1.002){
                // console.log(new Date().toLocaleTimeString() + " - aynı limit emirden daha önce oluşturulduğu için " + limit_price + " fiyatına tekrar limit buy emri oluşturulmayacak. alt_limit: " + limit_price*0.998 + " - ust_limit: " + limit_price*1.002)
                // console.log(buy_order_id_list)
                return;
            }
        }




        // 1. Limit Alış Emri Oluşturma
        const limitOrder = await binance.futuresBuy(coin_name, quantity, limit_price, { type: 'LIMIT' });

        // Emrin gerçekleşip gerçekleşmediğini kontrol et
        if (limitOrder && limitOrder.orderId) {
            console.log(coin_name + ' - Limit emri oluşturuldu: ' + limit_price);
            buy_order_id_list.push({"order_id":limitOrder.orderId, "buy_price":limit_price, "buy_quantity":quantity})
        }
        else {
            open('D:\\horoz_alarm.mp4');
            console.log(new Date().toLocaleTimeString() + " - limit emri oluşturmada hata: ")
            console.log(limitOrder)
            //limit oluştururken hata verirse ne yapılacak ? => biraz daha aşağıdan tekrar oluşturmayı denesin.
            limit_buy_emri(coin_name, limit_price)
            return

        }

        

    } catch (error) {
        console.error('Error placing orders:', error.body || error);
    }
}

async function short_buy_oco_order(coin_name, atr) { //short market buy
    /*
    let max_lev = await max_leverage(coin_name);
    if(max_lev<leverage){
        leverage = max_lev;
    }
    */

    let stepSize = await find_stepSize_quantity(coin_name);
    // let stepSize = await get_stepSize(coin_name);
    let lastPrice = await binance.futuresCandles(coin_name, "1d", { limit: 10 }).then(json => parseFloat(json[json.length - 1][4])).catch(err => console.log(new Date().toLocaleTimeString() + " -44err- " + err));
    
    

    await binance.futuresLeverage(coin_name, leverage).catch(err => console.log(new Date().toLocaleTimeString() + " -42err- " + err)); //kaldıraç
    await binance.futuresMarginType(coin_name, 'ISOLATED').catch(err => console.log(new Date().toLocaleTimeString() + " -41err- " + err));
    // await binance.futuresMarginType(coin_name, 'CROSSED')/*.then(json => console.log(json))*/.catch(err => console.log(new Date().toLocaleTimeString() + " -41err- " + err));


    var y = amount * leverage / lastPrice
    var quantity = parseFloat(y.toFixed(stepSize))

    await binance.futuresMarketSell(coin_name, quantity)
    .then((json) => {

        if (json.status == 'NEW') { //futuresMarketBuy işlemi başarılı 
            console.log(new Date().toLocaleTimeString() + ' - ' + (++buy_count) + ' - ' + coin_name + ', ' + lastPrice + ' fiyatından SHORT Market BUY ORDER verildi.');
            cancelOrder_and_reOpenOrder(coin_name, "short", atr);
        }
        else if (json.code < 0) { //futuresMarketBuy işlemi başarısız
            console.log(new Date().toLocaleTimeString() + " - " + coin_name + ", futuresMarketSell() işlemi yaparken HATA verdi => " + json.msg);
        }

    })
    .catch(err => console.log(new Date().toLocaleTimeString() + ' - short_buy_oco_order() içindeki futuresMarketBuy request hatası: ' + err))

    return {
        'coin_name':coin_name,
        'quantity':quantity,
        'amount':amount.toFixed(2),
    }
}


async function get_quantity(coin_name) {
    await bekle(5);

    let quantity = await binance.futuresAccount()
    .then(json => {
        for (let i = 0; i < json.positions.length; i++) {
            if (json.positions[i].symbol == coin_name) {
                return Math.abs(json.positions[i].positionAmt);
            }
        }
    }).catch(err => console.log("get_quantity() HATA: " + err))

    return quantity;
}

async function get_income() {

    let income = await binance.futuresIncome({ limit: 1000 })
    let today = new Date().toLocaleDateString();
    let kar_zarar = 0, komisyon = 0;

    for (let i = 0; i < income.length; i++) {
        if (new Date(income[i].time).toLocaleDateString() == today) {

            if (income[i].incomeType == "REALIZED_PNL" || income[i].incomeType == "INSURANCE_CLEAR") {
                kar_zarar += parseFloat(income[i].income);
            }
            else if (income[i].incomeType == "COMMISSION") {
                if (income[i].asset == "BNB") {
                    komisyon += await binance.futuresPrices({ symbol: 'BNBUSDT' }).then(json => parseFloat(json.price * income[i].income));
                } else if (income[i].asset == "USDT") {
                    komisyon += parseFloat(income[i].income);
                }
            }

        }
    }

    let bekleyen_miktar = await binance.futuresAccount()
        .then(json => {
            let acik_pozisyon_miktari = parseFloat(json.totalInitialMargin)
            if (acik_pozisyon_miktari > 0) {
                console.log("SATIŞ EMRİ BEKLEYEN COİN VAR ---> BEKLEYEN TOPLAM MİKTAR: " + acik_pozisyon_miktari.toFixed(2) + " $");
            }

            return acik_pozisyon_miktari;
        })

    if (bekleyen_miktar > 0) {
        let bekleyen_coinler = [];

        await binance.futuresPositionRisk()
            .then(json => {
                for (let i = 0; i < json.length; i++) {
                    if (json[i].positionAmt != 0) {
                        bekleyen_coinler.push({ 'coin_adi': json[i].symbol, 'alis_saati': new Date(json[i].updateTime).toLocaleTimeString(), 'alis_fiyati': json[i].entryPrice, 'guncel_fiyat': json[i].markPrice, 'likidite_olma_fiyati': json[i].liquidationPrice, 'kaldirac': json[i].leverage, 'pozisyon': json[i].entryPrice > json[i].liquidationPrice ? 'LONG' : 'SHORT', 'guncel_kar_zarar_durumu': json[i].unRealizedProfit >= 0 ? `${parseFloat(json[i].unRealizedProfit).toFixed(2)} $ kar` : `${parseFloat(json[i].unRealizedProfit).toFixed(2)} $ zarar` })
                    }
                }
            })

        console.log(bekleyen_coinler)
    }

}

async function get_profit() {
    let today = new Date().toLocaleDateString();
    let kar_zarar = 0, komisyon = 0, gunluk_al_sat_sayisi = 0;

    await binance.futuresIncome({ limit: 300 })
        .then(json => {
            if (json.code == -1003) {
                let ban_time = new Date(parseInt(json.msg.split(". ")[0].split(" ")[7])).toLocaleTimeString();
                console.log(json.msg)
                console.log(new Date().toLocaleTimeString() + " - get_profit() income request hatası verdi. ban kaldırılma zamanı: " + ban_time);
                hata_maili_gonder(json.msg);
            }
            else {
                for (let i = 0; i < json.length; i++) {
                    if (new Date(json[i].time).toLocaleDateString() == today) {

                        if (json[i].incomeType == "REALIZED_PNL" || json[i].incomeType == "INSURANCE_CLEAR") {
                            kar_zarar += parseFloat(json[i].income);
                            gunluk_al_sat_sayisi++;
                        }
                        else if (json[i].incomeType == "COMMISSION") {
                            if (json[i].asset == "BNB") {
                                //komisyon += await binance.futuresPrices({symbol:'BNBUSDT'}).then(json => parseFloat(json.price*income[i].income));
                                //bnb ile fee ödemesi yaparken atlanacak, await response dışına alınmalı.
                            } else if (json[i].asset == "USDT") {
                                komisyon += parseFloat(json[i].income);
                            }
                        }
                        else if (json[i].incomeType == "FUNDING_FEE"){
                            komisyon += parseFloat(json[i].income);
                        }
                    }
                }
            }
        })

    let net_kar_zarar = kar_zarar + komisyon;

    //return "Günlük AL/SAT Sayısı: " + gunluk_al_sat_sayisi + " - GÜNLÜK NET KAR/ZARAR => " + net_kar_zarar.toFixed(2) + " $";
    return "GÜNLÜK NET KAR/ZARAR => " + net_kar_zarar.toFixed(2) + " $";
}

async function gunluk_al_sat_yapildi() { //gece 12den sonra, gunluk_al_sat_sayisi SIFIRLANIYOR.

    let income = await binance.futuresIncome({ limit: 100 })
    let today = new Date().toLocaleDateString();

    for (let i = 0; i < income.length; i++) {
        if (new Date(income[i].time).toLocaleDateString() == today) {

            if (income[i].incomeType == "REALIZED_PNL" || income[i].incomeType == "INSURANCE_CLEAR") {
                return true;
            }
        }
    }

    return false;
}

async function sort_coins(coin_array) {
    for (let i = 0; i < coin_array.length; i++) {
        for (let j = 0; j < coin_array.length; j++) {
            if (coin_array[i].kazandirma_orani > coin_array[j].kazandirma_orani) {
                let temp_coin_name = coin_array[i].coin_name
                let temp_kazandirma_orani = coin_array[i].kazandirma_orani

                coin_array[i].coin_name = coin_array[j].coin_name
                coin_array[i].kazandirma_orani = coin_array[j].kazandirma_orani

                coin_array[j].coin_name = temp_coin_name
                coin_array[j].kazandirma_orani = temp_kazandirma_orani

            }
        }
    }
}

async function sort_list(coin_array) {
    for (let i = 0; i < coin_array.length; i++) {
        for (let j = 0; j < coin_array.length; j++) {
            if (coin_array[i].atr_degisim > coin_array[j].atr_degisim) {
                let temp_coin_name = coin_array[i].coin_name
                let temp_atr_degisim = coin_array[i].atr_degisim

                coin_array[i].coin_name = coin_array[j].coin_name
                coin_array[i].atr_degisim = coin_array[j].atr_degisim

                coin_array[j].coin_name = temp_coin_name
                coin_array[j].atr_degisim = temp_atr_degisim
            }
        }
    }
}

async function sort_long_short() {
    await bekle(20)

    //sorting coins in LONG array list
    for (let i = 0; i < long_list.length; i++) {
        for (let j = 0; j < long_list.length; j++) {
            if (long_list[i].atr < long_list[j].atr) {
                let temp_coin_name = long_list[i].coin_name
                let temp_atr = long_list[i].atr

                long_list[i].coin_name = long_list[j].coin_name
                long_list[i].atr = long_list[j].atr

                long_list[j].coin_name = temp_coin_name
                long_list[j].atr = temp_atr

            }
        }
    }

    if (long_list.length > 0) console.log(long_list)




    //sorting coins in SHORT array list
    for (let i = 0; i < short_list.length; i++) {
        for (let j = 0; j < short_list.length; j++) {
            if (short_list[i].atr < short_list[j].atr) {
                let temp_coin_name = short_list[i].coin_name
                let temp_atr = short_list[i].atr

                short_list[i].coin_name = short_list[j].coin_name
                short_list[i].atr = short_list[j].atr

                short_list[j].coin_name = temp_coin_name
                short_list[j].atr = temp_atr

            }
        }
    }

    if (short_list.length > 0) console.log(short_list)
}


async function alim_firsati_veren_coinler(){ //saatlik grafikte alım sinyali verdikten sonra aşağı düşmeye devam eden coinlerin listesini verir.

    coin_list = await coinler();
    let firsat_list = []

    try {
        for(let i=0;i<coin_list.length;i++){
            let data = await saat_calculate_indicators(coin_list[i].coin_name)
            if(data){
                for(let k=data.length-2;k>5;k--){
                    if(data[k]["rsi"]>67){
                        for(let a=k+2;a<data.length-2;a++){
                            if(data[a-1]["rsi"]<30 && data[a]["rsi"]>30 && data[a]["atr_degisim"]>1.5){
                                let entryPrice = data[a]["close"]
                                let lastPrice = data[data.length-2]["close"]
                                let atr_degisim = data[data.length-2]["atr_degisim"]
                                let degisim = (lastPrice-entryPrice)/entryPrice*100
                                let rsi = data[data.length-2]["rsi"]
                                
                                // firsat_list.push({"coin_name":data[a].coin_name, "degisim":degisim, "atr":atr_degisim, "rsi":rsi})

                                if(degisim<0){
                                    let dk_atr = await dk_calculate_indicators(data[a].coin_name)
                                    // console.log(data[a].date + " - " + data[a].time + " - " + data[a].coin_name + " - degisim: " + degisim.toFixed(2) + " - atr: " + atr_degisim.toFixed(2))
                                    firsat_list.push({"coin_name":data[a].coin_name, "degisim":degisim, "atr":atr_degisim, "rsi":rsi, "dk_atr":parseFloat(dk_atr[dk_atr.length-1].atr_degisim)})
                                }
                                
                                break
                            }
                        }
                        break
                    }
                }
            }
        }
    } catch (error) {
        console.log(error)
    }
    
    
    // Her elemandaki atr değerini .toFixed(2) yapma
    firsat_list = firsat_list.map(item => {
        return {
            ...item,
            atr: parseFloat(item.atr.toFixed(2)),
            degisim: parseFloat(item.degisim.toFixed(2))
        };
    });
    

    

    
    // console.log("TOP 5 Değişim") //en çok düşen coinler 
    // firsat_list.sort((a, b) => a.degisim - b.degisim);
    // console.log(firsat_list.slice(0, 5));

    console.log("TOP 5 ATR")
    firsat_list.sort((a, b) => b.atr - a.atr);
    console.log(firsat_list.slice(0, 5));

    //al sat yapılacak coin seçiyoruz.
    firsat_list.filter(item => item.rsi<50 && item.atr>2 && item.dk_atr>0.3)
    firsat_list.sort((a, b) => b.atr - a.atr); //saatlik atr'ye göre büyükten küçüğe sıralar. ilk eleman en yüksek olandır.

    //
    if(firsat_list.length>0){
        console.log("Özenle seçilen al/sat yapılacak coin: " + firsat_list[0].coin_name)
    }else{
        return "0"
    }
   

    

    //değişime göre top 5 içinden MAX ATR olan coine işlem yaptır =?
    return firsat_list[0].coin_name

}

async function coinler() {

    let coin_list = []

    await binance.futuresExchangeInfo()
        .then(json => {

            if (json.code == -1003) {
                let ban_time = new Date(parseInt(json.msg.split(". ")[0].split(" ")[7])).toLocaleTimeString();
                console.log(json.msg)
                console.log(new Date().toLocaleTimeString() + " - coinler() ban kaldırılma zamanı: " + ban_time);
                hata_maili_gonder(json.msg);
            }

            for (let i = 0; i < json.symbols.length; i++) {
                if (json.symbols[i].status == 'TRADING' && json.symbols[i].quoteAsset == 'USDT' && json.symbols[i].contractType == 'PERPETUAL') {
                    if (ignored_coin_list.indexOf(json.symbols[i].symbol) === -1) { //aranan eleman ignored_coin_list dizisinde yok ise coin_list dizisine eklenecek.
                        coin_list.push(json.symbols[i].symbol);
                    }
                }

            }
        })
        .catch(err => { console.log(new Date().toLocaleTimeString() + " - err1: " + err); hata_maili_gonder(err); })

    return coin_list
}


async function send_mail(kime, konu, mesaj) {

    var nodemailer = require('nodemailer');
    var transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: 'mustang15935746@gmail.com',
            pass: 'tjkfpsrwzfgswwss'
        }
    });
    var mailOptions = {
        from: 'mustang15935746@gmail.com',
        to: kime,
        subject: konu,
        text: mesaj
    };
    transporter.sendMail(mailOptions, function (error, info) {
        if (error) {
            console.log(error);
        } else {
            //console.log('Email sent: ' + info.response);
            //console.log(new Date().toLocaleTimeString() + " - Cüneyt maili gönderildi.");
        }
    });
}

async function send_mail_cuneyt(konu, mesaj){
    let hata=false
    while (true) {
        var nodemailer = require('nodemailer');
        var transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: 'mustang15935746@gmail.com',
                pass: 'tjkfpsrwzfgswwss'
            }
        });
        var mailOptions = {
            from: 'mustang15935746@gmail.com',
            to: 'gfbcnyt@gmail.com',
            subject: konu,
            text: mesaj
        };
        transporter.sendMail(mailOptions, function (error, info) {
            if (error) {
                hata=true
                console.log(error);
            } else {
                hata=false
                //console.log('Email sent: ' + info.response);
                // console.log(new Date().toLocaleTimeString() + " - Cüneyt maili gönderildi.");
            }
        });

        if(hata==true){
            console.log(new Date().toLocaleTimeString() + " - Mail gönderirken hata; " + konu)
            await bekle(60);
        }else{
            return;
        }
    }
}

// inputtan sayı alma
app.post("/amountGuncelle", (req, res) => {
  let gelenSayi = parseFloat(req.body.sayi);
  amount = gelenSayi
  console.log("Frontend'den gelen amount:", gelenSayi);
  res.json({ message: "Sayı alındı", gelenSayi });
});

// Web arayüzüne JSON dönen endpoint
app.get("/logs", (req, res) => {
  res.json({
    son_guncelleme_saati: son_guncelleme_saati,
    logs: logs,
  });
});

app.listen(PORT, () => {
//   console.log(`Server http://localhost:${PORT} adresinde calisiyor`);
});