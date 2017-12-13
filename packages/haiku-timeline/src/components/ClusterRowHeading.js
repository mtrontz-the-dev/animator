import React from 'react'
import Palette from 'haiku-ui-common/lib/Palette'

export default class ClusterRowHeading extends React.Component {
  constructor (props) {
    super(props)
    this.handleUpdate = this.handleUpdate.bind(this)
  }

  componentWillUnmount () {
    this.mounted = false
    this.props.row.removeListener('update', this.handleUpdate)
  }

  componentDidMount () {
    this.mounted = true
    this.props.row.on('update', this.handleUpdate)
  }

  handleUpdate (what) {
    if (!this.mounted) return null
    if (
      what === 'row-hovered' ||
      what === 'row-unhovered'
    ) {
      this.forceUpdate()
    }
  }

  render () {
    return (
      <span style={{
        textTransform: 'uppercase',
        fontSize: 10,
        color: (this.props.row.isHovered())
          ? Palette.ROCK
          : Palette.DARK_ROCK
      }}>
        {this.props.clusterName}
      </span>
    )
  }
}

ClusterRowHeading.propTypes = {
  row: React.PropTypes.object.isRequired,
  clusterName: React.PropTypes.string.isRequired
}
