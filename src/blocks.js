import render, {prepareTransition, renderTransition} from './render';
import CodeMirror from 'codemirror';

function getLocationFromEl(el) {
  // TODO: it's kind of lame to have line and ch as attributes on random elements.
  let line = el.getAttribute('line');
  let ch = el.getAttribute('ch');
  if (line === null || ch === null) {
    // no location to get...
    return null;
  }
  return {
    line: parseInt(line),
    ch: parseInt(ch)
  };
}

function findNearestNodeEl(el) {
  while (el !== document.body && !el.classList.contains('blocks-node')) {
    el = el.parentNode;
  }
  if (el === document.body) {
    return null;
  }
  return el;
}

const MARKER = Symbol("codemirror-blocks-marker");

export class BlockMarker {
  constructor(cmMarker, options){
    this.cmMarker = cmMarker;
    this.options = options;
  }
  clear() {
    if (this.options.css) {
      this.cmMarker.replacedWith.style.cssText = '';
    }
    if (this.options.title) {
      this.cmMarker.replacedWith.title = '';
    }
    if (this.options.className) {
      this.cmMarker.replacedWith.classList.remove(this.options.className);
    }
    delete this.cmMarker[MARKER];
  }
  find() {
    return this.cmMarker.find();
  }
}

export default class CodeMirrorBlocks {
  constructor(cm, parser, {willInsertNode, didInsertNode, renderOptions} = {}) {
    this.cm = cm;
    this.parser = parser;
    this.willInsertNode = willInsertNode;
    this.didInsertNode = didInsertNode;
    this.renderOptions = renderOptions;
    this.ast = null;
    this.blockMode = false;
    this.undoKeys = [];
    this.redoKeys = [];
    this.keyMap = CodeMirror.keyMap[this.cm.getOption('keyMap')];

    Object.assign(
      this.cm.getWrapperElement(),
      {
        onkeydown: this.handleKeyDown.bind(this),
        onclick: this.nodeEventHandler(this.selectNode),
        ondblclick: this.nodeEventHandler({
          literal: this.editLiteral,
          blank: this.editLiteral,
          whitespace: this.editWhiteSpace
        }),
        ondragstart: this.nodeEventHandler(this.startDraggingNode),
        ondragend: this.nodeEventHandler(this.stopDraggingNode),
        ondragleave: this.nodeEventHandler(this.handleDragLeave),
        ondrop: this.nodeEventHandler(this.dropOntoNode)
      }
    );
    // TODO: don't do this, otherwise we copy/paste will only work
    // when there is one instance of this class on a page.
    Object.assign(document, {
      oncut: this.handleCopyCut.bind(this),
      oncopy: this.handleCopyCut.bind(this)
    });

    var dropHandler = this.nodeEventHandler(this.dropOntoNode, true);
    var dragEnterHandler = this.nodeEventHandler(this.handleDragEnter);
    this.cm.on('drop',      (cm, e) => dropHandler(e));
    this.cm.on('dragenter', (cm, e) => dragEnterHandler(e));
    this.cm.on('keydown',   (cm, e) => this.handleKeyDown(e));
    this.cm.on('paste',     (cm, e) => this.insertionQuarantine(e));
    this.cm.on('keypress',  (cm, e) => this.insertionQuarantine(e));
    this.cm.on('mousedown', (cm, e) => this.cancelIfErrorExists(e));
    this.cm.on('dblclick',  (cm, e) => this.cancelIfErrorExists(e));
    this.cm.on('change',    this.handleChange.bind(this));
  }

  setBlockMode(mode) {
    // not changing anything: no-op
    if (mode === this.blockMode) {  
      return;   
    // turning off blocks: clear all markers
    } else if(!mode) {
      this.cm.getAllMarks().forEach(marker => marker.clear());
    // animated transition: set up the animated clones, render, and animate
    } else if (this.blockMode) {
      let clones = prepareTransition(this.ast, this.cm);
      this.cm.getWrapperElement().classList.remove(this.blockMode);
      this.cm.getWrapperElement().classList.add(mode);
      this.render();
      renderTransition(clones, this.ast, this.cm);
    // turning on block mode for the first time: just render
    } else {
      this.cm.getWrapperElement().classList.remove(this.blockMode);
      this.cm.getWrapperElement().classList.add(mode);
      this.render();
    }
    this.blockMode = mode;
  }

  handleChange() {
    if (this.blockMode) {
      this.render();
    }
  }

  markText(from, to, options) {
    let supportedOptions = new Set(['css','className','title']);
    let hasOptions = false;
    for (let option in options) {
      hasOptions = true;
      if (!supportedOptions.has(option)) {
        throw new Error(`option "${option}" is not supported by markText`);
      }
    }

    if (!hasOptions) {
      return; // noop
    }

    let marks = this.cm.findMarks(from, to);
    for (let mark of marks) {
      if (mark.replacedWith && mark.replacedWith.classList.contains('blocks-node')) {
        if (options.css) {
          mark.replacedWith.style.cssText = options.css;
        }
        if (options.className) {
          mark.replacedWith.className += ' '+options.className;
        }
        if (options.title) {
          mark.replacedWith.title = options.title;
        }
        mark[MARKER] = new BlockMarker(mark, options);
        return mark[MARKER]; // we should only find one that is a blocks-node
      }
    }
    // didn't find a codemirror mark, just pass through.
    this.cm.markText(from, to, options);
  }

  findMarks(from, to) {
    return this.cm.findMarks(from, to)
               .filter(mark => mark[MARKER])
               .map(mark => mark[MARKER]);
  }
  findMarksAt(pos) {
    return this.cm.findMarksAt(pos)
               .filter(mark => mark[MARKER])
               .map(mark => mark[MARKER]);
  }
  getAllMarks() {
    return this.cm.getAllMarks()
               .filter(mark => mark[MARKER])
               .map(mark => mark[MARKER]);
  }

  _clearMarks() {
    let marks = this.cm.findMarks({line: 0, ch: 0}, {line: this.cm.lineCount(), ch: 0});
    for (let mark of marks) {
      mark.clear();
    }
  }

  render() {
    this.ast = this.parser.parse(this.cm.getValue());
    this._clearMarks();
    for (let rootNode of this.ast.rootNodes) {
      render(rootNode, this.cm, this.renderOptions || {});
    }

  }

  getSelectedNode() {
    return this.findNodeFromEl(document.activeElement);
  }

  selectNode(node, event) {
    event.stopPropagation();
    node.el.focus();
    this.cm.scrollIntoView(node.from);
  }

  isNodeHidden(node) {
    return (node.el.classList.contains('blocks-hidden') ||
      node.el.matches('.blocks-hidden *'));
  }

  selectNextNode(event) {
    let nodeOrCursor = this.getSelectedNode() || this.cm.getCursor();
    let nextNode = this.ast.getNodeAfter(nodeOrCursor);
    while (this.isNodeHidden(nextNode)) {
      nextNode = this.ast.getNodeAfter(nextNode);
    }
    this.selectNode(nextNode, event);
  }

  selectPrevNode(event) {
    let nodeOrCursor = this.getSelectedNode() || this.cm.getCursor();
    let prevNode = this.ast.getNodeBefore(nodeOrCursor);
    while (this.isNodeHidden(prevNode)) {
      prevNode = this.ast.getNodeBefore(prevNode);
    }
    this.selectNode(prevNode, event);
  }

  handleCopyCut(event) {
    var activeEl = document.activeElement;
    if (!this.getSelectedNode()) {
      return;
    }
    var node = this.getSelectedNode();
    event.stopPropagation();
    var buffer = document.createElement('textarea');
    document.body.appendChild(buffer);
    buffer.style.opacity = "0";
    buffer.style.position = "absolute";
    buffer.innerText = this.cm.getRange(node.from, node.to);
    buffer.select();
    try {
      document.execCommand && document.execCommand(event.type);
    } catch (e) {
      console.error("execCommand doesn't work in this browser :(", e);
    }
    setTimeout(() => {
      activeEl.focus();
      buffer.parentNode && buffer.parentNode.removeChild(buffer);
    }, 200);
    if (event.type == 'cut') {
      this.cm.replaceRange('', node.from, node.to);
    }
  }

  saveEditableEl(nodeEl, text, range) {
    // See http://stackoverflow.com/questions/21926083/failed-to-execute-removechild-on-node
    // we have to remove the onblur handler first
    // because the blur event will fire *again* when the node is removed from the dom
    // which happens in this.cm.replaceRange.
    nodeEl.onblur = null;
    nodeEl.onkeydown = null;
    nodeEl.contentEditable = false;
    nodeEl.classList.remove('blocks-editing');
    nodeEl.classList.remove('blocks-error');
    this.cm.replaceRange(text, range.from, range.to);
  }

  checkEditableEl(nodeEl, text) {
    try {
      this.parser.lex(text);    // make sure the node itself is valid
      nodeEl.title = '';
      return true;
    } catch (e) {
      nodeEl.classList.add('blocks-error');
      try {
        nodeEl.title = this.parser.getExceptionMessage(e);
      } catch (e) {
        console.error(e);
      }
      console.error("result doesn't parse", e);
      return false;
    }
  }

  saveEdit(node, nodeEl, event) {
    event.preventDefault();
    if (this.checkEditableEl(nodeEl, nodeEl.innerText)) {
      if(node.quarantine){
        nodeEl.innerText += " "; // add space to avoid merging with nextSibling
        node.quarantine.clear(); // get rid of the quarantine bookmark
      }
      this.saveEditableEl(nodeEl, nodeEl.innerText, node);
    } else {
      // If the node doesn't parse, wrest the focus back after a few ms
      setTimeout(() => { this.editLiteral(node, event); }, 50);
      this.hasInvalidEdit = true;
    }
  }

  editWhiteSpace(whiteSpaceEl, event) {
    event.stopPropagation();
    whiteSpaceEl.contentEditable = true;
    whiteSpaceEl.classList.add('blocks-editing');
    whiteSpaceEl.onblur = this.saveWhiteSpace.bind(this, whiteSpaceEl);
    whiteSpaceEl.onkeydown = this.handleEditKeyDown.bind(whiteSpaceEl);
    let range = document.createRange();
    range.setStart(whiteSpaceEl, 0);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  }

  saveWhiteSpace(whiteSpaceEl) {
    var location = getLocationFromEl(whiteSpaceEl);
    var range = {from:location, to:location};
    if (this.checkEditableEl(whiteSpaceEl, ' '+whiteSpaceEl.innerText)) {
      this.saveEditableEl(whiteSpaceEl, ' '+whiteSpaceEl.innerText, range);
    }
  }

  handleEditKeyDown(e) {
    e.stopPropagation();
    e.codemirrorIgnore = true;
    let keyName = CodeMirror.keyName(e);
    if (["Enter", "Tab", "Esc"].includes(keyName)) {
      if(keyName === "Esc") { this.innerText = this.oldText || ""; }
      e.preventDefault();
      this.blur();
    }
  }

  editLiteral(node, event) {
    event.stopPropagation();
    node.el.oldText = this.cm.getRange(node.from, node.to);
    node.el.contentEditable = true;
    node.el.classList.add('blocks-editing');
    node.el.onblur = this.saveEdit.bind(this, node, node.el);
    node.el.onkeydown = this.handleEditKeyDown.bind(node.el);
    let range = document.createRange();
    range.setStart(node.el, node.quarantine? 1 : 0);
    range.setEnd(node.el, node.el.childNodes.length);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  }

  deleteSelectedNodes() {
    let node = this.getSelectedNode();
    if (node) {
      this.cm.replaceRange('', node.from, node.to);
    }
  }

  startDraggingNode(node, event) {
    event.stopPropagation();
    node.el.classList.add('blocks-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setDragImage(node.el, -5, -5);
    event.dataTransfer.setData('text/plain', this.cm.getRange(node.from, node.to));
    event.dataTransfer.setData('text/id', node.id);
  }

  stopDraggingNode(node) {
    node.el.classList.remove('blocks-dragging');
  }

  isDropTarget(el) {
    if (el.classList.contains('blocks-drop-target')) {
      return true;
    }
    var node = this.findNodeFromEl(el);
    if (node && ['literal', 'blank'].includes(node.type)) {
      return true;
    }
    return !node; // things outside of nodes are drop targets
  }

  handleDragEnter(node, event) {
    if (this.isDropTarget(event.target)) {
      event.stopPropagation();
      var el = node && this.isDropTarget(node.el) && node.el || event.target;
      el.classList.add('blocks-over-target');
    }
  }

  handleDragLeave(node, event) {
    if (this.isDropTarget(event.target)) {
      event.stopPropagation();
      event.target.classList.remove('blocks-over-target');
      if (node) {
        node.el.classList.remove('blocks-over-target');
      }
    }
  }

  findNodeFromEl(el) {
    el = findNearestNodeEl(el);
    if (el) {
      let match = el.id.match(/block-node-(.*)/);
      if (match && match.length > 1) {
        return this.ast.nodeMap.get(match[1]);
      }
    }
    return null;
  }

  dropOntoNode(destinationNode, event) {
    if (!this.isDropTarget(event.target)) {
      // not a drop taret, just return
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.target.classList.remove('blocks-over-target');
    let nodeId = event.dataTransfer.getData('text/id');
    if (!nodeId) {
      console.error("data transfer contains no node id. Not sure how to proceed.");
    }
    let sourceNode = this.ast.nodeMap.get(nodeId);
    if (!sourceNode) {
      console.error("node", nodeId, "not found in AST");
    }
    let sourceNodeText = this.cm.getRange(sourceNode.from, sourceNode.to);

    let destination = getLocationFromEl(event.target);

    if (!destination) {
      // event.target probably isn't a drop target, so just get the location from the event
      destination = this.cm.coordsChar({left:event.pageX, top:event.pageY});
      if (destination.outside) {
        sourceNodeText = '\n' + sourceNodeText;
      }
    }
    // TODO: figure out how to no-op more complicated changes that don't actually have any
    // impact on the AST.  For example, start with:
    //   (or #t #f)
    // then try to move the #f over one space. It should be a no-op.
    if ((destination.line == sourceNode.to.line && destination.ch == sourceNode.to.ch) ||
        (destination.line == sourceNode.from.line && destination.ch == sourceNode.from.ch)) {
      // destination is the same as source node location, so this should be a no-op.
      return;
    }

    this.cm.operation(() => {
      if (destinationNode && destinationNode.type == 'literal') {
        if (this.cm.indexFromPos(sourceNode.from) < this.cm.indexFromPos(destinationNode.from)) {
          this.cm.replaceRange(sourceNodeText, destinationNode.from, destinationNode.to);
          this.cm.replaceRange('', sourceNode.from, sourceNode.to);
        } else {
          this.cm.replaceRange('', sourceNode.from, sourceNode.to);
          this.cm.replaceRange(sourceNodeText, destinationNode.from, destinationNode.to);
        }
      } else {
        if (this.willInsertNode) {
          // give client code an opportunity to modify the sourceNodeText before
          // it gets dropped in. For example, to add proper spacing
          sourceNodeText = this.willInsertNode(
            sourceNodeText,
            sourceNode,
            destination,
            destinationNode
          );
        }
        if (this.cm.indexFromPos(sourceNode.from) < this.cm.indexFromPos(destination)) {
          this.cm.replaceRange(sourceNodeText, destination);
          this.cm.replaceRange('', sourceNode.from, sourceNode.to);
        } else {
          this.cm.replaceRange('', sourceNode.from, sourceNode.to);
          this.cm.replaceRange(sourceNodeText, destination);
        }
        if (this.didInsertNode) {
          this.didInsertNode(
            sourceNodeText,
            sourceNode,
            destination,
            destinationNode
          );
        }
      }
    });
  }

  insertionQuarantine(e) {
    e.preventDefault();
    let text = (e.type == "keypress")? String.fromCharCode(e.which)
             : e.clipboardData.getData('text/plain');
    let cur  = this.cm.getCursor();
    let ws = "\n".repeat(cur.line) + " ".repeat(cur.ch);  // make filler whitespace
    let ast  = this.parser.parse(ws + "x");               // make a fake literal
    let node = ast.rootNodes[0];                          // get its node
    render(node, this.cm, this.renderOptions || {});      // render the DOM element
    node.el.innerText = text;                             // replace "x" with the real string
    node.to.ch = node.from.ch;                            // force the width to be zero
    let mk = this.cm.setBookmark(cur, {widget: node.el}); // add the node as a bookmark
    node.quarantine = mk;                                 // store the marker in the node
    setTimeout(() => { this.editLiteral(node, e); }, 50); // give the DOM a few ms, then edit
  }

  handleKeyDown(event) {
    let keyName = CodeMirror.keyName(event);
    let selectedNode = this.getSelectedNode();
    // Enter and Backspace behave differently if a node is selected
    if (keyName == "Enter" && selectedNode &&
        ["literal", "blank"].includes(selectedNode.type)) {
      this.editLiteral(selectedNode, event);
    } else if (keyName == "Backspace" && selectedNode) {
      this.deleteSelectedNodes();
    } else if (keyName == "Tab") {
      this.selectNextNode(event);
    } else if (keyName == "Shift-Tab") {
      this.selectPrevNode(event);
    } else {
      let command = this.keyMap[keyName];
      if (typeof command == "string") {
        this.cm.execCommand(command);
      } else if (typeof command == "function") {
        command(this.cm);
      } else {
        return; // return without cancelling the event
      }
    }
    event.preventDefault();
    event.stopPropagation();
  }

  cancelIfErrorExists(event) {
    if(this.hasInvalidEdit){
      event.preventDefault();
      event.stopPropagation();
    }
  }

  nodeEventHandler(handlers, callWithNullNode=false) {
    if (typeof handlers == 'function') {
      handlers = {default: handlers};
    }
    return function(event) {
      let node = this.findNodeFromEl(event.target);
      if (node || callWithNullNode) {
        if (event.target.classList.contains('blocks-white-space')) {
          // handle white space differently.
          if (handlers.whitespace) {
            handlers.whitespace.call(this, event.target, event);
            return;
          }
        }
        if(event.target.classList.contains('blocks-blank')) {
          if(event.type == "dragstart"){
            event.stopPropagation();
            return false;
          }
        }
        if (node && handlers[node.type]) {
          handlers[node.type].call(this, node, event);
          return;
        }
        if (handlers.default) {
          handlers.default.call(this, node, event);
          return;
        }
      }
    }.bind(this);
  }

}
