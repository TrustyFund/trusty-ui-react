import alt from "alt-instance";
import ls from "common/localStorage";
import AccountStore from "stores/AccountStore";
import {ChainStore} from "bitsharesjs/es";
import MarketsActions from "actions/MarketsActions";
import MarketsStore from "stores/MarketsStore";
import Immutable from "immutable";
import AssetActions from 'actions/AssetActions';
import { dispatcher } from 'components/Trusty/utils';
import {Apis} from "bitsharesjs-ws";
import utils from "common/utils";
import PortfolioStore from "stores/PortfolioStore";
import WalletApi from "api/WalletApi";
import WalletDb from "stores/WalletDb";
import {LimitOrder,Price,LimitOrderCreate} from "common/MarketClasses";
import marketUtils from "common/market_utils";
import WalletUnlockStore from "stores/WalletUnlockStore";


class PortfolioActions {

    incrementAsset(asset){
        return dispatch => {
            dispatch({asset});
        }
    }

    decrementAsset(asset){
        return dispatch => {
            dispatch({asset});
        }
    }

    getNeedleSumsFromPortfolio(portfolio){
        let sells = [];
        let buys = [];
        portfolio.forEach((asset) => {
            if (asset.futureShare > asset.currentShare){
                asset.type = "buy";
            }else if(asset.futureShare < asset.currentShare){
                asset.type = "sell";
                console.log("TO SELL",asset)
                if (asset.futureShare == 0){
                    asset.amountToSell = asset.amount;
                }else{
                    let fullAmmountInCurrent = Math.floor(asset.amount * 100 / asset.currentShare);
                    let amountInFuture = Math.floor(fullAmmountInCurrent * asset.futureShare / 100);
                    let otherPortfolioAmount = fullAmmountInCurrent - asset.amount;
                    let amountToSell = fullAmmountInCurrent - otherPortfolioAmount - amountInFuture;
                    asset.amountToSell = amountToSell;
                }
            }else{
                asset.type = "none";
            }
        });
        return portfolio;
    }

    makeSellOrderCallback(asset,baseAsset,accountID){
        let quoteAsset = ChainStore.getObject(asset.assetMap.get("id"));
        
        return this.getMarktOrders(baseAsset,quoteAsset,"bids").then((bids)=>{
            let totalWants = 0;
            for (let i = 0; i < bids.length; i++){
                let bid = bids[i];
                let theyWants = bid.totalToReceive({noCache: true});
                totalWants += theyWants.amount;
                if (totalWants >= asset.amountToSell){

                    theyWants.amount = asset.amountToSell;
                    let weReceive = theyWants.times(bid.sellPrice());

                    let order = new LimitOrderCreate({
                        for_sale: theyWants,
                        to_receive: weReceive,
                        seller: accountID,
                        fee: {
                            asset_id: baseAsset.get("id"),
                            amount: 0
                        }
                    });
                    order.type = "sell";
                    //console.log("ORDER FOR " + asset.assetFullName,asset,order);
                    return order;
                }
            }
        });

    }


    getMarktOrders(baseAsset,quoteAsset,type = "bids"){
        let assets = {
            [quoteAsset.get("id")]: {precision: quoteAsset.get("precision")},
            [baseAsset.get("id")]: {precision: baseAsset.get("precision")}
        };
        return Apis.instance().db_api().exec("get_limit_orders", [ baseAsset.get("id"), quoteAsset.get("id"), 50 ])
        .then((results)=>{
            let orders = [];
            results.forEach((result) => {
                let order = new LimitOrder(result, assets, quoteAsset.get("id"));
                orders.push(order);
            });
            return (type == "bids") ? marketUtils.getBids(orders) : marketUtils.getAsks(orders);
        });
    }



    updatePortfolio(account, router){

                    
        PortfolioStore.setLoading();
        let port = PortfolioStore.getState().data;
        let portfolio = this.getNeedleSumsFromPortfolio(port);
        console.log("PORTFOLIO",portfolio)
        let baseAsset = ChainStore.getAsset("BTS");
        let ordersCallbacks = [];
        
        portfolio.forEach((asset)=>{
            if (asset.type == "sell"){
                if (asset.assetFullName != baseAsset.get("symbol")){
                    ordersCallbacks.push(this.makeSellOrderCallback(asset,baseAsset,account.get("id")));
                }
            }
        });

        return dispatch => {
            return Promise.all(ordersCallbacks).then(function(orders) {
                var buyTransaction = WalletApi.new_transaction();
                var sellTransaction = WalletApi.new_transaction();
                let sellCount = 0,buyCount = 0;
                orders.forEach((order)=>{
                    order.setExpiration();
                    if (order.type == "buy"){
                        order = order.toObject();
                        buyTransaction.add_type_operation("limit_order_create", order);
                        buyCount++;
                    }
                    if (order.type == "sell"){
                        order = order.toObject();
                        sellTransaction.add_type_operation("limit_order_create", order);
                        sellCount++;
                    }
                });

                if (sellCount){
                    WalletDb.process_transaction(sellTransaction, null, true).then(result => {
                        console.log("DONE TRANSACTION",result);
                        dispatch();
                    })
                    .catch(error => {
                        console.log("order error:", error);
                        return {error};
                    });
                }else{
                    dispatch(0);
                }
            });
        }
    }

    

    concatPortfolio(account){
        
        portfolioStorage.set("portfolio",{});

        let portfolioData = PortfolioStore.getPortfolio().data.slice()

        let data = getActivePortfolio(account, portfolioData).concat(portfolioData)

        let port = {
            data,
            map: data.map(b=>b.assetShortName)
        }
        return dispatch =>{
            return new Promise((resolve, reject)=>{
                Promise.resolve().then(()=>{
                    port.data.forEach((item, index)=>{
                        Apis.instance().db_api().exec("list_assets", [
                            item.assetFullName, 1
                        ]).then(assets => {
                            ChainStore._updateObject(assets[0], false);
                            let bal = port.data[index];
                            bal.assetMap = createMap(assets[0]);
                            if(!bal.balanceMap) {
                                bal.balanceID = null;
                                bal.balanceMap = createMap({
                                    id:"0",
                                    owner: "0",
                                    asset_type: "0",
                                    balance: "0"
                                })
                                bal.amount = 0;
                                bal.currentShare =  0;
                                bal.bitUSDShare = 0;
                            }
                            if(!bal.futureShare) bal.futureShare = 0;
                        })  
                    })
                    
                }).then(()=>{
                    port.totalFutureShare = 0;
                    port.data.forEach(i=>{
                        PortfolioStore.getState().data && PortfolioStore.getState().data.forEach(already=>{
                            if(already.assetShortName == i.assetShortName) {
                                i.futureShare = already.futureShare;
                            }
                        })
                        port.totalFutureShare += i.futureShare;
                    })

                    portfolioStorage.set("portfolio",port);
                    resolve(port);
                    dispatch(port);
                })
            })
        }
    }
}

let portfolioStorage = new ls("__trusty_portfolio__");

const createMap = (myObj) =>{
     return new Map(
        Object
            .keys(myObj)
            .map(
                key => [key, myObj[key]]
            )
    )
}

const countShares = (amount, fromAsset, percentage=false) => {

    fromAsset = ChainStore.getObject(fromAsset)
    let toAsset = ChainStore.getAsset("USD")

    if(!toAsset) return 0

    let marketStats = MarketsStore.getState().allMarketStats

    let coreAsset = ChainStore.getAsset("1.3.0");
    let toStats, fromStats;
    let toID = toAsset.get("id");
    let toSymbol = toAsset.get("symbol");
    let fromID = fromAsset.get("id");
    let fromSymbol = fromAsset.get("symbol");

    if (coreAsset && marketStats) {
        let coreSymbol = coreAsset.get("symbol");
        toStats = marketStats.get(toSymbol + "_" + coreSymbol);
        fromStats = marketStats.get(fromSymbol + "_" + coreSymbol);
    }

    let price = utils.convertPrice(fromStats && fromStats.close ? fromStats.close :
                                    fromID === "1.3.0" || fromAsset.has("bitasset") ? fromAsset : null,
                                    toStats && toStats.close ? toStats.close :
                                    (toID === "1.3.0" || toAsset.has("bitasset")) ? toAsset : null,
                                    fromID,
                                    toID);

    let eqValue = price ? utils.convertValue(price, amount, fromAsset, toAsset) : 0;


    let TRFNDPrice = 0



    let formatValue = v => v < 1 ? Math.ceil(v) : Math.floor(v) || 0

    if(fromAsset.get("symbol") == "TRFND") {

        let { combinedBids, highestBid } = MarketsStore.getState().marketData

        TRFNDPrice = combinedBids.map(order=>order.getPrice())[0]

        let asset = fromAsset.toJS()
        let precision = utils.get_asset_precision(asset.precision);
        let p = (TRFNDPrice * (amount / precision))
        let totalBts = localStorage.getItem("_trusty_bts_total_value")

        if(!totalBts) return 0

        let percent = ((p/totalBts)*100)
        if(percentage) return formatValue(percent)

        let totalAmount = +localStorage.getItem("_trusty_total_value")
        if(!totalAmount) return 0

        return formatValue(totalAmount/100*percent)

    } 

    if(percentage) {
        let totalAmount = +localStorage.getItem("_trusty_total_value")
        if(!totalAmount) return 0
        let percent = eqValue.toFixed(2) / totalAmount.toFixed(2) * 100
        return formatValue(percent)
    } else {
        let asset = toAsset.toJS()
        let precision = utils.get_asset_precision(asset.precision);
        return formatValue(eqValue / precision)
    }
}

let getActivePortfolio = (account, portfolioData)=>{

    let balances  = PortfolioStore.getBalances(account)

    let activeBalaces = []

    balances.forEach(b=> {

        let balance = ChainStore.getObject(b)
        let balanceAsset = ChainStore.getObject(balance.get("asset_type"))

        if (balanceAsset) {

            let data = portfolioData.filter(p=>{
                return p.assetShortName==balanceAsset.get("symbol") || p.assetFullName==balanceAsset.get("symbol")
            })
            let futureShare
            if(data.length){
               futureShare = portfolioData.splice(portfolioData.findIndex(i=>i.assetFullName==data[0].assetFullName), 1)[0].futureShare 
            } 
            let asset_type = balance.get("asset_type");
            let asset = ChainStore.getObject(asset_type);
            if(asset) {
                let s = asset.get("symbol")
                let amount = Number(balance.get("balance"))
                activeBalaces.push({
                    balanceID: b,
                    balanceMap: balance,
                    assetShortName: ~s.search(/open/i)?s.substring(5):s,
                    assetFullName: s, 
                    futureShare: futureShare || 0, 
                    currentShare: +countShares(amount, asset_type, true), 
                    bitUSDShare: +countShares(amount, asset_type),
                    amount,
                })    
            } 
        
        }
       
    })

    return activeBalaces

}

export default alt.createActions(PortfolioActions)