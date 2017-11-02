import React from "react";
import FormattedAsset from "../../Utility/FormattedAsset";
import {Link} from "react-router/es";
import classNames from "classnames";
import Translate from "react-translate-component";
import counterpart from "counterpart";
import utils from "common/utils";
import BlockTime from "../../Blockchain/BlockTime";
import LinkToAccountById from "../../Utility/LinkToAccountById";
import LinkToAssetById from "../../Utility/LinkToAssetById";
import BindToChainState from "../../Utility/BindToChainState";
import ChainTypes from "../../Utility/ChainTypes";
import TranslateWithLinks from "../../Utility/TranslateWithLinks";
import {ChainStore, ChainTypes as grapheneChainTypes} from "bitsharesjs/es";
import account_constants from "chain/account_constants";
import MemoText from "../../Blockchain/MemoText";
import ProposedOperation from "../../Blockchain/ProposedOperation";
import marketUtils from "common/market_utils";
import {connect} from "alt-react";
import SettingsStore from "stores/SettingsStore";

const {operations} = grapheneChainTypes;

let ops = Object.keys(operations);
let listings = account_constants.account_listing;

class TransactionLabel extends React.Component {
    shouldComponentUpdate(nextProps) {
        return (
            nextProps.color !== this.props.color ||
            nextProps.type !== this.props.type
        );
    }
    render() {
        let trxTypes = counterpart.translate("transaction.trxTypes");
        let labelClass = classNames("label", this.props.color || "info");
        return (
            <span className={labelClass}>
                {trxTypes[ops[this.props.type]]}
            </span>
        );
    }
}

class Row extends React.Component {
    static contextTypes = {
        router: React.PropTypes.object.isRequired
    }

    static propTypes = {
        dynGlobalObject: ChainTypes.ChainObject.isRequired,
    };

    static defaultProps = {
        dynGlobalObject: "2.1.0",
    };

    constructor(props) {
        super(props);
    }

    shouldComponentUpdate(nextProps) {
        let {block, dynGlobalObject} = this.props;
        let last_irreversible_block_num = dynGlobalObject.get("last_irreversible_block_num" );
        if (nextProps.dynGlobalObject === this.props.dynGlobalObject) {
            return false;
        }
        return block > last_irreversible_block_num;
    }

    render() {
        return this.props.info;
    }
}
Row = BindToChainState(Row, {keep_updating:true});

class Operation extends React.Component {

    static defaultProps = {
        op: [],
        current: "",
        block: null,
        hideOpLabel: false,
        csvExportMode: false
    };

    static propTypes = {
        op: React.PropTypes.array.isRequired,
        current: React.PropTypes.string,
        block: React.PropTypes.number,
        csvExportMode: React.PropTypes.bool
    };

    componentWillReceiveProps(np) {
        if (np.marketDirections !== this.props.marketDirections) {
            this.forceUpdate();
        }
    }

    shouldComponentUpdate(nextProps) {
        if (!this.props.op || !nextProps.op) {
            return false;
        }
        return !utils.are_equal_shallow(nextProps.op[1], this.props.op[1]) ||
            nextProps.marketDirections !== this.props.marketDirections;
    }

    render() {
        let {op, current, block} = this.props;
        let line = null, column = null, color = "info";
        let memoComponent = null;

        color = "success";
        op[1].amount.amount = parseFloat(op[1].amount.amount);

        column = (
            <p className="_yellow">
                Receive {op[1].amount.amount / 100000} BTS
            </p>
        );

        line = (
            <Row
                block={block}
                type={op[0]}
                color={color}
                fee={op[1].fee}
                hideOpLabel={this.props.hideOpLabel}
                hideDate={this.props.hideDate}
                info={column}
                hideFee={this.props.hideFee}
            >
            </Row>
        )



        return line;
    }
}


Operation = connect(Operation, {
    listenTo() {
        return [SettingsStore];
    },
    getProps() {
        return {
            marketDirections: SettingsStore.getState().marketDirections
        };
    }
});

export default Operation;
