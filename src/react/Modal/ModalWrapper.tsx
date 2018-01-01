import * as React from 'react';
import Palette from './../../Palette';

const STYLES = {
  backgroundColor: Palette.COAL,
  borderRadius: '4px',
  zIndex: 9001,
  cursor: 'auto',
  margin: 'auto',
  position: 'absolute',
  top: '80px',
  left: '0',
  right: '0'
}

export class ModalWrapper extends React.PureComponent {
  props;

  render () {
    return (
      <div style={{...STYLES, ...this.props.style}}>
        {this.props.children}
      </div>
    )
  }
}
