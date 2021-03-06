const tape = require('tape');
const path = require('path');
const fse = require('haiku-fs-extra');
const async = require('async');
const Project = require('./../../src/bll/Project');
const Timeline = require('./../../src/bll/Timeline');

tape('Timeline#frameInfo', (t) => {
  const subproc = process.env.HAIKU_SUBPROCESS;
  process.env.HAIKU_SUBPROCESS = 'timeline';
  // Start fresh.
  while (Timeline.count() > 0) {
    const timeline = Timeline.find();
    Timeline.remove(timeline, t);
  }
  return setupTest('timeline-01', (ac, rows, done) => {
    t.deepEqual(Timeline.count(), 1);
    const timeline = ac.getCurrentTimeline();
    timeline.setTimelinePixelWidth(1000);
    const expectedFrameInfo = {
      fps: 60,
      mspf: 1000 / 60, // 60fps
      maxms: 5000,
      maxf: 300,
      fri0: 0,
      friA: 0,
      friMax: 300,
      friMaxVirt: 60 * 2,
      friB: 60,
      pxpf: 1000 / 60,
      pxA: 0,
      pxB: 60 * (1000 / 60),
      pxMax: 5000,
      msA: 0,
      msB: 1000,
      scL: 1000 + 300,
      scRatio: 5000 / (1000 + 300),
      scA: 0,
      scB: 1000 / (5000 / (1000 + 300)),
    };
    t.deepEqual(timeline.getFrameInfo(), expectedFrameInfo);

    timeline.setTimelinePixelWidth(1500);
    t.deepEqual(
      timeline.getFrameInfo(),
      {
        ...expectedFrameInfo,
        pxpf: 1500 / 60,
        pxB: 60 * (1500 / 60),
        pxMax: 5000 * 1500 / 1000,
        scL: 1500 + 300,
        scRatio: 5000 * (1500 / 1000) / (1500 + 300),
        scB: 1000 / (5000 / (1500 + 300)),
      },
    );

    timeline.setTimelinePixelWidth(1000);
    t.deepEqual(timeline.getFrameInfo(), expectedFrameInfo);

    timeline.updateVisibleFrameRangeByDelta(500);
    t.deepEqual(
      timeline.getFrameInfo(),
      // TODO: Show how these values are derived.
      {
        ...expectedFrameInfo,
        friA: 500,
        friMax: 560,
        friMaxVirt: 560,
        friB: 560,
        pxA: 8333.333333333334,
        pxB: 9333.333333333334,
        pxMax: 9333.333333333334,
        msA: 8333,
        msB: 9333,
        scRatio: 7.17948717948718,
        scA: 1160.7142857142858,
        scB: 1300,
      },
    );

    process.env.HAIKU_SUBPROCESS = subproc;
    done(t.end);
  });
});

const PATH_SVG_1 = `
  <?xml version="1.0" encoding="UTF-8"?>
  <svg width="99px" height="69px" viewBox="0 0 99 69" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
      <!-- Generator: sketchtool 46.2 (44496) - http://www.bohemiancoding.com/sketch -->
      <title>PathPen</title>
      <desc>Created with sketchtool.</desc>
      <defs>
        <foobar id="abc123"></foobar>
      </defs>
      <g id="Page-1" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">
          <g foobar="url(#abc123)" id="Artboard" transform="translate(-283.000000, -254.000000)" stroke="#979797">
              <path d="M294.851562,260.753906 C282.404105,283.559532 310.725273,290.63691 326.835937,295.734375 C331.617305,297.247215 342.059558,301.595875 338.316406,309.21875 C337.259516,311.371092 335.344104,313.379399 333.070312,314.140625 C316.687518,319.6253 318.607648,314.107756 316.175781,298.535156 C314.073483,285.072967 341.353724,262.381072 307.847656,273.160156 C302.953426,274.734657 299.363413,279.037222 295.621094,282.5625 C294.703984,283.426421 289.762583,289.749326 292.835937,292.191406 C310.800174,306.465746 310.629063,293.466831 327.605469,293.117188 C340.400227,292.853669 361.733615,282.532042 364.140625,298.585938 C364.591437,301.592694 366.227007,305.49551 364.140625,307.707031 C356.643614,315.653704 320.800977,318.428842 316.511719,304 C313.310899,293.23261 309.646651,279.191944 316.511719,270.300781 L317.605469,266.996094 C318.70025,265.578208 319.962133,263.856288 321.726562,263.546875 C348.187608,258.906626 333.406544,260.284286 342.546875,271.855469 C345.091836,275.077257 351.639186,275.674796 351.988281,279.765625 L354.464844,283.632812 C357.416932,318.226499 296.30014,340.100228 293.25,300.105469 C292.638094,292.081893 291.431499,283.803546 293.25,275.964844 C294.715721,269.646813 297.246721,262.379048 302.785156,259.003906 C320.414927,248.260262 322.400502,263.451084 330.808594,271.378906 C333.565871,273.978688 339.302903,273.7221 340.503906,277.316406 C343.115394,285.131945 334.783267,296.681412 341.050781,302.03125 C348.504241,308.39339 366.513246,311.846671 370.4375,302.867188 L372.515625,301.476562 C387.936662,266.190128 352.052706,234.955091 328.25,269.800781 C322.336272,278.458113 340.249653,294.392337 330.753906,301.621094 C326.91332,304.544788 294.058884,308.199097 286.269531,307.359375 C284.995803,307.222062 284.102217,305.584758 283.921875,304.316406 C282.389249,293.537418 285.731973,295.96395 292.257812,288.046875 C311.385715,264.841117 307.46635,267.289874 346.21875,270.695312 C348.526208,270.898085 351.084913,271.703414 352.59375,273.460938 C354.971579,276.230679 354.398541,281.016656 357.144531,283.421875 C361.463282,287.20468 369.172641,295.592094 372.613281,290.996094 C396.717804,258.797319 361.228307,257.906354 349.429687,268.339844 C338.784302,277.753531 347.977468,308.238322 342.097656,310.683594 C334.379679,313.893313 325.61253,313.607482 317.28125,314.285156 C310.815625,314.811077 304.233838,315.258597 297.820312,314.285156 C296.449037,314.077025 295.446155,312.335074 295.328125,310.953125 C294.594926,302.368493 293.381654,293.498605 295.328125,285.105469 C302.241349,255.29581 326.590452,265.047417 334.488281,291.011719 C336.03704,296.103302 335.56021,306.996168 340.308594,312.417969 C354.750775,328.908343 356.425475,297.576804 356.195312,291.328125" id="Path-4"></path>
          </g>
      </g>
  </svg>
`;

const setupTest = (name, cb) => {
  const folder = path.join(__dirname, '..', 'fixtures', 'projects', name);
  fse.removeSync(folder);
  const websocket = {on: () => {}, send: () => {}, action: () => {}, connect: () => {}};
  const platform = {};
  const userconfig = {};
  const fileOptions = {doWriteToDisk: false, skipDiffLogging: true};
  const envoyOptions = {mock: true};
  return Project.setup(folder, 'test', websocket, platform, userconfig, fileOptions, envoyOptions, (err, project) => {
    if (err) {
 throw err;
}
    return project.setCurrentActiveComponent('main', {from: 'test'}, (err) => {
      if (err) {
 throw err;
}
      fse.outputFileSync(path.join(folder, 'designs/Path.svg'), PATH_SVG_1);
      const ac = project.getCurrentActiveComponent();
      return ac.instantiateComponent('designs/Path.svg', {}, {from: 'test'}, (err) => {
        if (err) {
 throw err;
}
        const rows = ac.getRows().filter((row) => row.isProperty()).slice(0, 3);
        return async.eachSeries(rows, (row, next) => {
          const mss = [0, 1000, 2000, 3000, 4000, 5000];
          return async.eachSeries(mss, (ms, next) => {
            row.createKeyframe(undefined, ms, {from: 'test'});
            return setTimeout(() => next(), 100);
          }, next);
        }, (err) => {
          if (err) {
 throw err;
}
          cb(ac, rows, (finish) => {
            if (global.haiku && global.haiku.HaikuGlobalAnimationHarness) {
              global.haiku.HaikuGlobalAnimationHarness.cancel();
            }
            fse.removeSync(folder);
            finish();
          });
        });
      });
    });
  });
};
