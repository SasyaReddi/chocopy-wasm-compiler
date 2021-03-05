import { PyInt, PyBool, PyNone, PyObj } from "../utils";
import { assert, asserts, assertPrint } from "./utils.test";

describe("LIST TEST", () => {
  //Programs described in the writeup, with additional changes
  //as necessary to actually test functionality
  var source = `
        items : [int] = None
        items = [1, 2, 3, 4, 5, 6, 7, 8]
        items[7]
    `;

  assert("Program 2: Assign List To Variable", source, PyInt(8));

  var source = `
    items : [int] = None
    items = [1, 2, 3] + [4, 5, 6]
    items[5]
    `;

  assert("Program 3: Concat Lists", source, PyInt(6));

  var source = `
        items : [int] = None
        n : int = 10
        items = [1, 2]
        n = items[0] + items[1]
        n
    `;

  assert("Program 4: Lists Access", source, PyInt(1 + 2));

  //Other Tests
  assert("Empty List", "[]", PyObj(`list<none>`, 540));
  assert("List With Number", "[1,2,3]", PyObj(`list<number>`, 632));

  assert("Lists Declaration", "items : [int] = None\nitems", PyNone());

  var source = `
        class A(object):
            n:int = 100
        x : [A] = None
        x1 : A = None
        x2 : A = None
        x3 : A = None  
        x = [A(),A(),A()]
        x[1].n
        `;
  assert("List With Class", source, PyInt(100));

  var source = `
    items : [bool] = None
    stuff : [bool] = None
    concatted : [bool] = None
    items = [True, True, False]
    stuff = [False, True]
    concatted = items + stuff
    concatted[4]
  `;
  assert("Concat List Vars", source, PyBool(true));
});
