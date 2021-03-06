/**
 * Copyright (c) Haiku 2016-2018. All rights reserved.
 */

const path = require('path');

const ConcatPlugin = require('webpack-concat-plugin');

const LOTTIE_BASE = path.resolve(require.resolve('lottie-web'), '..', '..', '..', 'player', 'js');

module.exports = {
  devtool: 'source-map',
  watch: true,
  entry: {
    HaikuDOMAdapter: path.resolve(require.resolve('@haiku/core'), '..', 'src', 'adapters', 'dom'),
  },
  output: {
    path: path.resolve(__dirname, 'webpack'),
    filename: '[name].js',
    library: '[name]',
    libraryTarget: 'window',
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /src\/.+\.ts$/,
        loader: 'ts-loader',
        options: {
	  configFile: path.join(__dirname, '..', '..', '@haiku', 'core', 'tsconfig.json'),
        },
      },
    ],
  },
  plugins: [
    new ConcatPlugin({
      sourceMap: true,
      fileName: 'LottieWeb.js',
      filesToConcat: [
        // What's a require()?
        'main.js',
        'utils/common.js',
        'utils/BaseEvent.js',
        'utils/helpers/arrays.js',
        'utils/helpers/svg_elements.js',
        'utils/helpers/html_elements.js',
        'utils/helpers/dynamicProperties.js',
        '3rd_party/transformation-matrix.js',
        '3rd_party/seedrandom.js',
        '3rd_party/BezierEaser.js',
        'utils/animationFramePolyFill.js',
        'utils/functionExtensions.js',
        'utils/bez.js',
        'utils/DataManager.js',
        'utils/FontManager.js',
        'utils/PropertyFactory.js',
        'utils/TransformProperty.js',
        'utils/shapes/ShapePath.js',
        'utils/shapes/ShapeProperty.js',
        'utils/shapes/ShapeModifiers.js',
        'utils/shapes/TrimModifier.js',
        'utils/shapes/RoundCornersModifier.js',
        'utils/shapes/RepeaterModifier.js',
        'utils/shapes/ShapeCollection.js',
        'utils/shapes/DashProperty.js',
        'utils/shapes/GradientProperty.js',
        'utils/shapes/shapePathBuilder.js',
        'utils/imagePreloader.js',
        'utils/featureSupport.js',
        'utils/filters.js',
        'utils/asset_loader.js',
        'utils/text/TextAnimatorProperty.js',
        'utils/text/TextAnimatorDataProperty.js',
        'utils/text/LetterProps.js',
        'utils/text/TextProperty.js',
        'utils/text/TextSelectorProperty.js',
        'utils/pooling/pool_factory.js',
        'utils/pooling/pooling.js',
        'utils/pooling/point_pool.js',
        'utils/pooling/shape_pool.js',
        'utils/pooling/shapeCollection_pool.js',
        'utils/pooling/segments_length_pool.js',
        'utils/pooling/bezier_length_pool.js',
        'renderers/BaseRenderer.js',
        'renderers/SVGRenderer.js',
        'renderers/CanvasRenderer.js',
        'renderers/HybridRenderer.js',
        'mask.js',
        'elements/helpers/HierarchyElement.js',
        'elements/helpers/FrameElement.js',
        'elements/helpers/TransformElement.js',
        'elements/helpers/RenderableElement.js',
        'elements/helpers/RenderableDOMElement.js',
        'elements/helpers/shapes/ProcessedElement.js',
        'elements/helpers/shapes/SVGStyleData.js',
        'elements/helpers/shapes/SVGShapeData.js',
        'elements/helpers/shapes/SVGTransformData.js',
        'elements/helpers/shapes/SVGStrokeStyleData.js',
        'elements/helpers/shapes/SVGFillStyleData.js',
        'elements/helpers/shapes/SVGGradientFillStyleData.js',
        'elements/helpers/shapes/SVGGradientStrokeStyleData.js',
        'elements/helpers/shapes/ShapeGroupData.js',
        'elements/helpers/shapes/SVGElementsRenderer.js',
        'elements/helpers/shapes/CVShapeData.js',
        'elements/BaseElement.js',
        'elements/NullElement.js',
        'elements/svgElements/SVGBaseElement.js',
        'elements/ShapeElement.js',
        'elements/TextElement.js',
        'elements/CompElement.js',
        'elements/ImageElement.js',
        'elements/SolidElement.js',
        'elements/svgElements/SVGCompElement.js',
        'elements/svgElements/SVGTextElement.js',
        'elements/svgElements/SVGShapeElement.js',
        'elements/svgElements/effects/SVGTintEffect.js',
        'elements/svgElements/effects/SVGFillFilter.js',
        'elements/svgElements/effects/SVGStrokeEffect.js',
        'elements/svgElements/effects/SVGTritoneFilter.js',
        'elements/svgElements/effects/SVGProLevelsFilter.js',
        'elements/svgElements/effects/SVGDropShadowEffect.js',
        'elements/svgElements/effects/SVGMatte3Effect.js',
        'elements/svgElements/SVGEffects.js',
        'elements/canvasElements/CVContextData.js',
        'elements/canvasElements/CVBaseElement.js',
        'elements/canvasElements/CVImageElement.js',
        'elements/canvasElements/CVCompElement.js',
        'elements/canvasElements/CVMaskElement.js',
        'elements/canvasElements/CVShapeElement.js',
        'elements/canvasElements/CVSolidElement.js',
        'elements/canvasElements/CVTextElement.js',
        'elements/canvasElements/CVEffects.js',
        'elements/htmlElements/HBaseElement.js',
        'elements/htmlElements/HSolidElement.js',
        'elements/htmlElements/HCompElement.js',
        'elements/htmlElements/HShapeElement.js',
        'elements/htmlElements/HTextElement.js',
        'elements/htmlElements/HImageElement.js',
        'elements/htmlElements/HCameraElement.js',
        'elements/htmlElements/HEffects.js',
        'animation/AnimationManager.js',
        'animation/AnimationItem.js',
        'utils/expressions/Expressions.js',
        'utils/expressions/ExpressionManager.js',
        'utils/expressions/ExpressionPropertyDecorator.js',
        'utils/expressions/ExpressionTextPropertyDecorator.js',
        'utils/expressions/ShapeInterface.js',
        'utils/expressions/TextInterface.js',
        'utils/expressions/LayerInterface.js',
        'utils/expressions/CompInterface.js',
        'utils/expressions/TransformInterface.js',
        'utils/expressions/ProjectInterface.js',
        'utils/expressions/EffectInterface.js',
        'utils/expressions/MaskInterface.js',
        'utils/expressions/ExpressionValue.js',
        'effects/SliderEffect.js',
        'EffectsManager.js',
        'module.js',
      ].map((asset) => path.join(LOTTIE_BASE, asset)),
    }),
  ],
};
