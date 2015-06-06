'use strict'

var gulp = require('gulp')
var gulpSequence = require('gulp-sequence')
var mocha = require('gulp-mocha')

gulp.task('mocha', function () {
  return gulp.src('test/index.js', {read: false})
    .pipe(mocha({
      timeout: 8000
    }))
})

gulp.task('default', gulpSequence('test'))

gulp.task('cluster', gulpSequence('mocha-cluster'))

gulp.task('test', gulpSequence('mocha'))
