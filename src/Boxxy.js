import Block from './Block';
import getNode from './utils/getNode';
import { addClass } from './utils/class';
import { setStyles } from './utils/style';
import configure from './utils/configure';
import {
	ROW,
	COLUMN,
	WIDTH,
	HEIGHT
} from './utils/constants';

function normalise ( block, options ) {
	let id, node;

	// expand short-form blocks
	if ( Object.prototype.toString.call( block ) === '[object Array]' ) {
		block = { children: block };
	} else if ( node = getNode( block ) ) {
		block = { node };
	}

	// TODO deprecate this behaviour
	if ( typeof block === 'string' ) {
		let nodeId = block;
		block = { node: document.createElement( 'boxxy-block' ) };
		block.node.id = nodeId;
	}

	let children;

	if ( block.children ) {
		let totalSize = 0;
		block.children.forEach( child => {
			totalSize += ( child.size || 1 );
		});

		children = block.children.map( function ( child, i ) {
			return normalise( child, {
				type: options.type === COLUMN ? ROW : COLUMN,
				isFirst: i === 0,
				isLast: i === block.children.length - 1,
				totalSize: totalSize,
				lineage: options.lineage.concat( i )
			});
		});
	}

	node = block.node ? getNode( block.node ) : document.createElement( 'boxxy-block' );
	id = options.lineage.join( '-' );

	node.setAttribute( 'data-boxxy-id', id );

	setStyles( node, {
		position: 'absolute',
		width: '100%',
		height: '100%'
	});

	return {
		id:       id,
		node:     node,
		children: children,

		type:     options.type,
		isFirst:  options.isFirst,
		isLast:   options.isLast,
		size:     ( 'size' in block ? block.size : 1 ) / options.totalSize,
		min:      block.min || 0,
		max:      block.max
	};
}

function getInitialState ( blocks, state ) {
	let acc = 0;

	blocks.forEach( block => {
		if ( block.children ) {
			getInitialState( block.children, state );
		}

		state[ block.id ] = { start: acc, size: block.size };
		acc += block.size;
	});
}

function Boxxy ( node, options ) {
	var blocks, resizeHandler;

	this.container = getNode( node );
	if ( !this.container ) {
		throw new Error( '`node` must be a DOM node, an ID, or a CSS selector' );
	}

	this.node = document.createElement( 'boxxy' );

	this._defaultCursor = this.node.style.cursor;

	if ( options.columns && options.rows ) {
		throw new Error( 'You can\'t have top level rows and top level columns - one or the other' );
	}

	if ( options.columns ) {
		this.type = ROW;
		blocks = options.columns;
	} else if ( options.rows ) {
		this.type = COLUMN;
		blocks = options.rows;
	}

	let normalised = normalise({
		node: this.node,
		children: blocks
	}, {
		type: this.type,
		totalSize: 1,
		lineage: [ 0 ]
	});

	this.blocks = {};
	this._callbacks = {}; // events

	this.min = options.min || 10;

	this.root = new Block({
		boxxy: this,
		parent: this,
		id: 'boxxy-0',
		data: normalised,
		start: 0,
		size: 1,
		type: this.type,
		edges: { top: true, right: true, bottom: true, left: true }
	});

	addClass( this.root.node, 'boxxy-root' );

	resizeHandler = () => {
		this._changedSinceLastResize = {};
		this.shake();
		this._fire( 'resize', this._changedSinceLastResize );
	};

	window.addEventListener( 'resize', resizeHandler );

	this.container.appendChild( this.node );

	this._changed = {};
	this._changedSinceLastResize = {};

	let initialState = {};
	initialState[ this.root.id ] = { start: 0, size: 1 };
	getInitialState( normalised.children, initialState );
	console.log( 'initialState', initialState );

	initialState[ '0-0' ].size = 0.3;
	initialState[ '0-1' ].start = 0.3;
	initialState[ '0-1' ].size = 0.7;

	this.setState( initialState );
	this.shake();
}

Boxxy.prototype = {
	_fire ( eventName, data ) {
		let callbacks = this._callbacks[ eventName ];

		if ( !callbacks ) return;

		for ( let i = 0, len = callbacks.length; i < len; i += 1 ) {
			callbacks[i].call( this, data );
		}
	},

	_setCursor ( direction ) {
		if ( !direction ) {
			this.node.style.cursor = this._defaultCursor;
			return;
		}

		this.node.style.cursor = `${direction}-resize`;
	},

	shake () {
		let { left, right, top, bottom } = this.node.getBoundingClientRect();

		this.bcr = {
			left, right, top, bottom,
			width: right - left,
			height: bottom - top
		};

		if ( ( this.bcr.width === this.width ) && ( this.bcr.height === this.height ) ) {
			return; // nothing to do
		}

		this.width = this.bcr.width;
		this.height = this.bcr.height;

		this.pixelSize = this[ this.type === COLUMN ? HEIGHT : WIDTH ];

		this.root.shake();

		return this;
	},

	changed () {
		var changed = this._changed;
		this._changed = {};

		return changed;
	},

	getState () {
		var state = {};

		this.root.getState( state );
		return state;
	},

	setState ( state ) {
		var changed = {}, key;

		this.root.setState( state, changed );

		// if any of the sizes have changed, fire a resize event...
		for ( key in changed ) {
			if ( changed.hasOwnProperty( key ) ) {
				this._fire( 'resize', changed );

				// ...but only the one
				break;
			}
		}
		return this;
	},

	save ( id ) {
		var key, value;

		if ( !localStorage ) {
			return;
		}

		key = ( id ? 'boxxy_' + id : 'boxxy' );
		value = JSON.stringify( this.getState() );

		localStorage.setItem( key, value );

		return this;
	},

	restore ( id ) {
		var key, value;

		if ( !localStorage ) {
			return;
		}

		key = ( id ? `boxxy_${id}` : 'boxxy' );
		value = JSON.parse( localStorage.getItem( key ) );

		if ( value ) {
			this.setState( value );
		}

		return this;
	},

	on ( eventName, callback ) {
		if ( !this._callbacks.hasOwnProperty( eventName ) ) {
			this._callbacks[ eventName ] = [];
		}

		this._callbacks[ eventName ].push( callback );

		return {
			cancel: () => this.off( eventName, callback )
		};
	},

	off ( eventName, callback ) {
		var index, callbacks;

		if ( !eventName ) {
			// remove all listeners
			this._callbacks = {};
			return this;
		}

		if ( !callback ) {
			// remove all listeners of eventName
			delete this._callbacks[ eventName ];
			return this;
		}

		if ( !( callbacks = this._callbacks[ eventName ] ) ) {
			return this;
		}

		index = callbacks.indexOf( callback );

		if ( index !== -1 ) {
			callbacks.splice( index, 1 );
			if ( !callbacks.length ) {
				delete this._callbacks[ eventName ];
			}
		}

		return this;
	}
};

Boxxy.configure = configure;

export default Boxxy;