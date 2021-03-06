import React from 'react';
import PrimitiveList from './PrimitiveList';
import PrimitiveBlock from './PrimitiveBlock';
import classNames from 'classnames';

require('./Toolbar.less');

export default React.createClass({
  displayName: 'Toolbar',

  getDefaultProps() {
    return {
      blocks: {parser:{}}
    };
  },

  getInitialState() {
    return {
      search: '',
      selectedPrimitive: null,
    };
  },

  changeSearch(event) {
    this.setState({search: event.target.value});
  },

  clearSearch() {
    this.setState({search: ''});
  },

  checkEscape(event) {
    if (event.key == 'Escape') {
      event.target.blur();
      event.preventDefault();
    }
  },

  selectPrimitive(selectedPrimitive) {
    if (selectedPrimitive === this.state.selectedPrimitive) {
      selectedPrimitive = null;
    }
    this.setState({selectedPrimitive});
  },

  render() {
    let parser = this.props.blocks.parser;
    let primitives = [];
    if (parser.primitives) {
      primitives = parser.primitives.filter(this.state.search).primitives;
    }
    let selected = this.state.selectedPrimitive;
    return (
      <div className={classNames('blocks-ui Toolbar', {'has-selected':!!selected})}>
        <div className="search-box">
          <input type="search"
                 placeholder="Search Primitives"
                 className="form-control"
                 value={this.state.search}
                 onKeyDown={this.checkEscape}
                 onChange={this.changeSearch} />

          {this.state.search ?
           <span className="glyphicon glyphicon-remove" onClick={this.clearSearch} />
           : null}
        </div>
        <div className="primitives-box">
          <PrimitiveList
            primitives={primitives}
            highlight={this.state.search}
            onSelect={this.selectPrimitive}
            selected={this.state.selectedPrimitive}
          />
        </div>
        <div className="selected-primitive">
          <div className="contract-header">Contract</div>
          <PrimitiveBlock primitive={selected} />
        </div>
      </div>
    );
  }
});
