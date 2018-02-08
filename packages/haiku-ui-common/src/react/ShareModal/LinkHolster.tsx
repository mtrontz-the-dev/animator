import * as React from 'react'
import * as assign from 'lodash.assign'
import {shell} from 'electron'
import * as CopyToClipboard from 'react-copy-to-clipboard'
import {ThreeBounce} from 'better-react-spinkit'
import Palette from '../../Palette'
import {CliboardIconSVG} from '../OtherIcons'
import {LoadingTopBar} from '../../LoadingTopBar'

const STYLES = {
  linkHolster: {
    height: '30px',
    cursor: 'pointer',
    backgroundColor: Palette.SPECIAL_COAL,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingLeft: '15px',
    marginBottom: '5px',
    borderRadius: '3px',
    overflow: 'hidden',
    position: 'relative'
  } as React.CSSProperties,
  link: {
    color: Palette.BLUE,
    fontSize: '10px'
  },
  linkCopyBtn: {
    height: '100%',
    background: Palette.COAL,
    padding: '0 8px',
    display: 'flex',
    alignItems: 'center'
  } as React.CSSProperties,
}

export class LinkHolster extends React.PureComponent {
  props

  static propTypes = {
    isSnapshotSaveInProgress: React.PropTypes.bool,
    linkAddress: React.PropTypes.string
  }

  state = {
    done: false
  }

  componentWillReceiveProps(nextProps) {
    if (nextProps.isSnapshotSaveInProgress !== this.props.isSnapshotSaveInProgress) {
      setTimeout(() => {
        this.setState({done: !nextProps.isSnapshotSaveInProgress})
      }, 1000)
    }
  }

  render() {
    const {
      isSnapshotSaveInProgress,
      linkAddress
    } = this.props

    return (
      <div style={STYLES.linkHolster}>
        <LoadingTopBar
          progress={this.props.isSnapshotSaveInProgress ? 100 : 0}
          speed={this.props.isSnapshotSaveInProgress ? '15s' : '1ms'}
          done={this.state.done}
        />
        {isSnapshotSaveInProgress ? (
          <span style={STYLES.link}>New share link being generated</span>
        ) : (
          <span
            style={STYLES.link}
            onClick={() => shell.openExternal(linkAddress)}
          >
            {linkAddress ? linkAddress.substring(0, 33) : ''}
          </span>
        )}
        <CopyToClipboard text={this.props.linkAddress}>
          <span style={STYLES.linkCopyBtn}>
            <CliboardIconSVG />
          </span>
        </CopyToClipboard>
      </div>
    )
  }
}
