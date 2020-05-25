import * as debug from '../util/debug';
import {H264Parser} from '../parsers/h264.js';
import {BaseRemuxer} from './base.js';
import {MediaFrames, TrackType} from "../controller/remux";
import {NALU} from "../util/nalu";

export class H264Remuxer extends BaseRemuxer {

    private nextDts = 0;
    protected timescale = 1000;
    private h264: H264Parser;

    constructor() {
        super({
            id: BaseRemuxer.getTrackID(),
            type: TrackType.Video,
            len: 0,
            fragmented: true,
            width: 0,
            height: 0,
            timescale: 1000,
            duration: 1000,
            samples: [],
        });
        this.h264 = new H264Parser(this);
    }

    resetTrack() {
        this.readyToDecode = false;
        this.mp4track.sps = '';
        this.mp4track.pps = '';
    }

    remux(samples:MediaFrames[]) {
        let sample,
            units,
            unit,
            size,
            keyFrame;
        for (sample of samples) {
            units = [];
            size = 0;
            keyFrame = false;
            for (unit of (sample.units as NALU[])) {
                if (this.h264.parseNAL(unit)) {
                    units.push(unit);
                    size += unit.getSize();
                    if (!keyFrame) {
                        keyFrame = unit.isKeyframe();
                    }
                }
            }

            if (units.length > 0 && this.readyToDecode) {
                this.mp4track.len += size;
                this.samples.push({
                    units: units,
                    size: size,
                    keyFrame: keyFrame,
                    duration: sample.duration,
                });
            }
        }
    }

    getPayload() {
        if (!this.isReady()) {
            return null;
        }

        let payload = new Uint8Array(this.mp4track.len);
        let offset = 0;
        let samples = this.mp4track.samples;
        let mp4Sample,
            duration;

        this.dts = this.nextDts;

        while (this.samples.length) {
            let sample = this.samples.shift(),
                units = sample.units;

            duration = sample.duration;

            if (duration <= 0) {
                debug.log(`remuxer: invalid sample duration at DTS: ${this.nextDts} :${duration}`);
                this.mp4track.len -= sample.size;
                continue;
            }

            this.nextDts += duration;
            mp4Sample = {
                size: sample.size,
                duration: duration,
                cts: 0,
                flags: {
                    isLeading: 0,
                    isDependedOn: 0,
                    hasRedundancy: 0,
                    degradPrio: 0,
                    isNonSync: sample.keyFrame ? 0 : 1,
                    dependsOn: sample.keyFrame ? 2 : 1,
                },
            };

            for (const unit of units) {
                payload.set(unit.getData(), offset);
                offset += unit.getSize();
            }

            samples.push(mp4Sample);
        }

        if (!samples.length) return null;

        return new Uint8Array(payload.buffer, 0, this.mp4track.len);
    }
}
