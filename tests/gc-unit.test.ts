import "mocha";
import { expect } from "chai";
import { PyInt, PyBool, PyNone } from "../utils";
import { Block, BitMappedBlocks } from "../heap";
import {
  Header,
  HEADER_SIZE_BYTES,
  HeapTag,
  MarkableAllocator,
  MnS,
  TAG_CLASS,
  TAG_LIST,
  TAG_STRING,
  TAG_DICT,
  TAG_BIGINT,
  TAG_REF,
  TAG_DICT_ENTRY,
  TAG_OPAQUE,
} from "../gc";

import { Pointer } from "../alloc";

class PhantomAllocator implements MarkableAllocator {

  heap: MarkableAllocator;
  map: Map<BigInt, Header>;

  constructor(a: MarkableAllocator) {
    this.heap = a;
    this.map = new Map();
  }

  alloc(size: bigint): Block {
    return this.heap.alloc(size);
  }

  free2(ptr: Pointer): void {
    if (!this.map.delete(ptr)) {
      throw new Error(`Pointer '${ptr}' is not in the map`);
    }
    this.heap.free2(ptr);
  }

  owns(ptr: Pointer): boolean {
    const result = this.heap.owns(ptr);
    const tracking = !this.map.has(ptr);
    if ((result && !tracking) || (!result && tracking)) {
      throw new Error(`Ownership mismatch: { result: ${result}, tracking: ${tracking}}`);
    }

    return result && tracking;
  }

  gcalloc(tag: HeapTag, size: bigint): Pointer {
    console.log(`Trying to allocate size: ${size}\t(tag=${tag})`);
    const result = this.heap.gcalloc(tag, size);
    if (result === 0x0n) {
      console.log(`Failed to allocated ${size}\t\t(tag=${tag})`);
      return result;
    }

    const header = this.heap.getHeader(result);
    this.map.set(result, header);

    console.log(`Allocated ${size} at ${result} \t\t(tag=${tag}, header=${header.headerStart})`);
    return result;
  }

  mappedHeader(ptr: BigInt): Header {
    const result = this.map.get(ptr);
    if (result === undefined) {
      throw new Error(`No header mapped for ${ptr}`);
    }
    return result;
  }

  getHeader(ptr: Pointer): Header {
    const result = this.heap.getHeader(ptr);
    const tracked = this.map.get(ptr);
    if (tracked === undefined) {
      throw new Error(`Missing header for ${ptr}`);
    }
    if (result.headerStart !== tracked.headerStart) {
      throw new Error(`Header starts not equal: { result: ${result.headerStart}, tracked: ${tracked.headerStart}}`);
    }

    return result;
  }

  sweep() {
    console.log("Sweeping...");
    this.heap.sweep();
    console.log("Finished sweeping");
  }

  description(): string {
    throw new Error("unreachable");
  }
}

function readI32(memory: Uint8Array, start: number): bigint {
  let x = BigInt.asUintN(32, 0x0n);

  // WASM stores integers in little-endian:
  //   LSB at the smallest address
  for (let i = 0; i < 4; i++) {
    const b = BigInt(memory[start + i]);
    x = x + (b << BigInt(8 * i));
  }

  return x;
}

function writeI32(memory: Uint8Array, start: number, value: bigint) {
  // WASM stores integers in little-endian:
  //   LSB at the smallest address
  for (let i = 0; i < 4; i++) {
    const b = BigInt.asUintN(8, value >> BigInt(8 * i));
    memory[start + i] = Number(b);
  }
}

function expectAllocatedHeader(header: Header, tag: HeapTag, size: bigint) {
  expect(header.isAlloced()).to.equal(true);
  expect(header.isMarked()).to.equal(false);
  expect(Number(header.getSize())).to.equal(Number(size));
  expect(Number(header.getTag())).to.equal(Number(tag));
}

function expectFreeHeader(header: Header, tag: HeapTag, size: bigint) {
  expect(header.isAlloced()).to.equal(false);
  expect(header.isMarked()).to.equal(false);
  expect(Number(header.getSize())).to.equal(Number(size));
  expect(Number(header.getTag())).to.equal(Number(tag));
}

describe("MnS", () => {
  describe("MnS-BumpAllocator-1", () => {
    let memory: Uint8Array;
    let heap: PhantomAllocator;

    beforeEach(() => {
      memory = new Uint8Array(512);
      const bmb = new BitMappedBlocks(100n, 200n, 4n, BigInt(HEADER_SIZE_BYTES));
      heap = new PhantomAllocator(bmb);
    });

    // Simulating:
    // class C:
    //   f: int
    //
    // def x():
    //   x = C()
    //   x = C()
    //   y = C()
    //
    // f()
    it("local variable class allocate and sweep", () => {
      const mns = new MnS(memory, heap);

      mns.roots.pushFrame();
      const ptr0 = mns.gcalloc(TAG_CLASS, 4n);
      expect(Number(ptr0)).to.equal(100);
      mns.roots.addLocal(0n, ptr0);

      const ptr1 = mns.gcalloc(TAG_CLASS, 4n);
      expect(Number(ptr1)).to.equal(104);
      mns.roots.addLocal(0n, ptr1);

      const ptr2 = mns.gcalloc(TAG_CLASS, 4n);
      expect(Number(ptr2)).to.equal(108);
      mns.roots.addLocal(1n, ptr2);

      // Check that headers set correctly
      {
        const headers = [
          heap.mappedHeader(ptr0),
          heap.mappedHeader(ptr1),
          heap.mappedHeader(ptr2)
        ];
        headers.forEach((h, index) => {
          console.log(`Checking header: ${index}...`);
          expectAllocatedHeader(h, TAG_CLASS, 4n);
        });
      }

      mns.collect();

      // Check that only ptr0 is freed
      {
        const header0 = heap.mappedHeader(ptr0);
        const header1 = heap.mappedHeader(ptr1);
        const header2 = heap.mappedHeader(ptr2);

        expectFreeHeader(header0, TAG_CLASS, 4n);
        expectAllocatedHeader(header1, TAG_CLASS, 4n);
        expectAllocatedHeader(header2, TAG_CLASS, 4n);
      }

      mns.roots.releaseLocals();
      mns.collect();
      // Check that ptr0, ptr1, ptr2 is freed
      {
        const headers = [
          heap.mappedHeader(ptr0),
          heap.mappedHeader(ptr1),
          heap.mappedHeader(ptr2)
        ];
        headers.forEach((h, index) => {
          // console.warn(`Checking header: ${index}...`);
          expectFreeHeader(h, TAG_CLASS, 4n);
        });
      }
      const ptr0new = mns.gcalloc(TAG_CLASS, 4n);
      expect(Number(ptr0new)).to.equal(100);

      expectFreeHeader(heap.heap.getHeader(112n), 0x0n as HeapTag, 0n);
    });

    // Simulates:
    //
    //   call(C(), C(), C())
    it("temporary class allocate and sweep", () => {
      const mns = new MnS(memory, heap);

      mns.roots.captureTemps();
      const ptr0 = mns.gcalloc(TAG_CLASS, 4n);
      expect(Number(ptr0)).to.equal(100);

      const ptr1 = mns.gcalloc(TAG_CLASS, 4n);
      expect(Number(ptr1)).to.equal(104);

      const ptr2 = mns.gcalloc(TAG_CLASS, 4n);
      expect(Number(ptr2)).to.equal(108);

      // Check that headers set correctly
      {
        const headers = [
          heap.mappedHeader(ptr0),
          heap.mappedHeader(ptr1),
          heap.mappedHeader(ptr2)
        ];
        headers.forEach((h, index) => {
          console.log(`Checking header: ${index}...`);
          expectAllocatedHeader(h, TAG_CLASS, 4n);
        });
      }
      mns.collect();
      // Check that all temps are still allocated
      {
        const headers = [
          heap.mappedHeader(ptr0),
          heap.mappedHeader(ptr1),
          heap.mappedHeader(ptr2)
        ];
        headers.forEach((h, index) => {
          console.log(`Checking header: ${index}...`);
          expectAllocatedHeader(h, TAG_CLASS, 4n);
        });
      }

      mns.roots.releaseTemps();
      mns.collect();
      // Check that ptr0, ptr1, ptr2 is freed
      {
        const headers = [
          heap.mappedHeader(ptr0),
          heap.mappedHeader(ptr1),
          heap.mappedHeader(ptr2)
        ];
        headers.forEach((h, index) => {
          // console.warn(`Checking header: ${index}...`);
          expectFreeHeader(h, TAG_CLASS, 4n);
        });
      }
      const ptr0new = mns.gcalloc(TAG_CLASS, 4n);
      expect(Number(ptr0new)).to.equal(100);

      expectFreeHeader(heap.heap.getHeader(112n), 0x0n as HeapTag, 0n);
    });
  });
});
